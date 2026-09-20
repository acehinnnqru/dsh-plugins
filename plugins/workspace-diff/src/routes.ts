/**
 * The two authenticated routes the view reads.
 *
 * Both are GETs below /api, which is what puts them behind Connection's authentication fence: a
 * same-origin fetch() from the browser needs no extra credential handling. Both answer JSON with
 * cache-control: no-store, because every answer describes the working tree *now*.
 *
 * The diff route takes a repository-relative path, never an absolute one, and only uses it after the
 * status call for that same Session reported it. The two routes are separate requests, so the diff
 * handler re-resolves the Session and re-runs that status parse through {@link readWorkspace} before
 * it touches the path — there is deliberately no per-Session cache, because a cache would make the
 * accepted set stale.
 * @module dsh-plugin-workspace-diff/routes
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
// Type-only: each carries the Context merge that puts its service on `ctx`.
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-shell'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import {
  CHANGES_PATH,
  DIFF_MAX_BYTES,
  DIFF_PATH,
  FILE_MAX_BYTES,
  GIT_TIMEOUT_MS,
  STATUS_MAX_BYTES,
  headCommand,
  isBinaryDiff,
  numstatCommand,
  parseNumstat,
  parsePorcelainV2,
  parseUnifiedHunks,
  rootCommand,
  sizeCommand,
  statusCommand,
  trackedDiffCommand,
  untrackedDiffCommand,
  untrackedNumstatCommand,
  withCounts,
  type ChangedFile,
  type ChangedPath,
  type DiffCounts,
} from './git.ts'

/** Every domain reason either route can answer. */
export type FailureReason =
  | 'not-a-repo'
  | 'no-git'
  | 'no-cwd'
  | 'truncated'
  | 'not-in-repo'
  | 'too-large'
  | 'binary'

/** A refusal the browser shows as an empty state. */
export interface Failure {
  readonly ok: false
  readonly reason: FailureReason
}

/** One workspace read, shared by both handlers. */
interface Workspace {
  readonly repoRoot: string
  readonly unborn: boolean
  readonly files: readonly ChangedFile[]
}

/** Every JSON answer is uncacheable: it describes the working tree at this instant. */
const NO_STORE = { 'cache-control': 'no-store' } as const

/**
 * @param body - the JSON body.
 * @param status - the HTTP status; domain refusals keep 200 so the browser reads the reason.
 * @returns the response.
 */
function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

/**
 * Register both routes on Connection's fetch registry.
 * @param ctx - host context carrying the Connection, shell, Session, and sandbox services.
 */
export function registerWorkspaceDiffRoutes(ctx: Context): void {
  ctx.connection.fetch.register({
    path: CHANGES_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => changesResponse(ctx, request),
  })
  ctx.connection.fetch.register({
    path: DIFF_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => diffResponse(ctx, request),
  })
}

/**
 * Read the Session id off the query and resolve its workspace directory.
 * @param ctx - host context carrying the Session query engine.
 * @param request - the incoming request.
 * @returns the id and the Session's cwd, a refusal, or the response to send as-is.
 */
async function sessionOf(
  ctx: Context,
  request: Request,
): Promise<{ sessionId: SessionId; cwd: string } | Failure | Response> {
  const sessionId = new URL(request.url).searchParams.get('sessionId')
  if (sessionId === null || sessionId === '') return new Response('sessionId is required.', { status: 400 })

  let cwd: string | undefined
  try {
    const snapshot = await ctx.sessionQuery.readSession(sessionId as SessionId)
    cwd = snapshot.session.cwd
  } catch (error) {
    // Only a missing Session is a 404; anything else is this Host's own failure.
    if (errorCode(error) !== 'SESSION_QUERY_SESSION_NOT_FOUND') throw error
    return new Response('Unknown session.', { status: 404, headers: NO_STORE })
  }

  if (cwd === undefined) return { ok: false, reason: 'no-cwd' }
  return { sessionId: sessionId as SessionId, cwd }
}

/**
 * Run one git command through the profile's own executor.
 *
 * The executor resolves on a nonzero exit, so every caller reads the exit code. The sandbox policy
 * is the Session's own where one is live — an in-process resolve() without it silently gets the
 * deployment default (mode read-only, root process.cwd()) rather than the Session's directory.
 * GIT_OPTIONAL_LOCKS=0 keeps git status from refreshing the index, so the read-only default still
 * works.
 * @param ctx - host context carrying the executor and the sandbox policy.
 * @param session - the live Session, when the store still holds one.
 * @param workdir - the directory to run in.
 * @param command - the command text.
 * @param stdoutMaxBytes - this call's stdout budget.
 * @param signal - caller cancellation.
 * @returns the executor's result.
 */
async function runGit(
  ctx: Context,
  session: Session | undefined,
  workdir: string,
  command: string,
  stdoutMaxBytes: number,
  signal: AbortSignal,
): Promise<ShellRunResult> {
  const spec = ctx.shell.resolve({
    command,
    workdir,
    timeoutMs: GIT_TIMEOUT_MS,
    stdoutMaxBytes,
    signal,
    env: { GIT_OPTIONAL_LOCKS: '0' },
    sandboxPolicy: ctx.sandboxPolicy.resolve(session === undefined ? {} : { session }),
  })
  return await ctx.shell.run(spec)
}

/**
 * Resolve the repository and read its changed-file list.
 * @param ctx - host context.
 * @param session - the live Session, when there is one.
 * @param cwd - the Session's working directory.
 * @param signal - caller cancellation.
 * @returns the workspace read, or the refusal to answer with.
 */
async function readWorkspace(
  ctx: Context,
  session: Session | undefined,
  cwd: string,
  signal: AbortSignal,
): Promise<Workspace | Failure> {
  const root = await runGit(ctx, session, cwd, rootCommand(), 1 << 16, signal)
  if (root.exitCode !== 0) {
    return { ok: false, reason: root.exitCode === 127 || root.exitCode === null ? 'no-git' : 'not-a-repo' }
  }
  const repoRoot = root.stdout.text.trim()
  if (repoRoot === '') return { ok: false, reason: 'not-a-repo' }

  // An unborn HEAD is not an error: it is the signal to compare against the index instead.
  const head = await runGit(ctx, session, repoRoot, headCommand(), 1 << 12, signal)
  const unborn = head.exitCode !== 0

  const status = await runGit(ctx, session, repoRoot, statusCommand(), STATUS_MAX_BYTES, signal)
  if (status.exitCode !== 0) return { ok: false, reason: 'not-a-repo' }
  // Truncated output is the tail: the list it would produce is missing its front, so refuse it
  // rather than serve a list the user would read as complete.
  if (status.stdout.truncated) return { ok: false, reason: 'truncated' }

  const parsed = parsePorcelainV2(status.stdout.text, false)
  const counts = await countsOf(ctx, session, repoRoot, unborn, signal, parsed.files)
  return { repoRoot, unborn, files: parsed.files.map((file) => withCounts(file, counts)) }
}

/**
 * Read the per-file counts once for the whole request.
 * @param ctx - host context.
 * @param session - the live Session, when there is one.
 * @param repoRoot - the repository root to run in.
 * @param unborn - whether HEAD exists.
 * @param signal - caller cancellation.
 * @param files - the status parse, whose untracked entries need a second pass.
 * @returns counts keyed by repository-relative new path; a missing row means "not counted".
 */
async function countsOf(
  ctx: Context,
  session: Session | undefined,
  repoRoot: string,
  unborn: boolean,
  signal: AbortSignal,
  files: readonly ChangedPath[],
): Promise<ReadonlyMap<string, DiffCounts>> {
  const counts = new Map<string, DiffCounts>()
  const tracked = await runGit(ctx, session, repoRoot, numstatCommand(unborn), STATUS_MAX_BYTES, signal)
  if (tracked.exitCode === 0) {
    for (const [path, row] of parseNumstat(tracked.stdout.text)) counts.set(path, row)
  }

  // New files have no row against HEAD, so they are counted against the empty tree instead. That
  // command exits 1 by design (the files differ), which is why only its stdout is read.
  const command = untrackedNumstatCommand(files.filter((file) => file.status === '?').map((file) => file.path))
  if (command !== undefined) {
    const untracked = await runGit(ctx, session, repoRoot, command, STATUS_MAX_BYTES, signal)
    for (const [path, row] of parseNumstat(untracked.stdout.text)) counts.set(path, row)
  }

  return counts
}

/**
 * @param ctx - host context.
 * @param session - the live Session, when there is one.
 * @param repoRoot - the repository root.
 * @param path - the repository-relative path.
 * @param signal - caller cancellation.
 * @returns the file's size in bytes, or undefined when it cannot be read (a deleted file, say).
 */
async function fileSize(
  ctx: Context,
  session: Session | undefined,
  repoRoot: string,
  path: string,
  signal: AbortSignal,
): Promise<number | undefined> {
  const result = await runGit(ctx, session, repoRoot, sizeCommand(path), 1 << 12, signal)
  if (result.exitCode !== 0) return undefined
  const size = Number.parseInt(result.stdout.text.trim(), 10)
  return Number.isSafeInteger(size) && size >= 0 ? size : undefined
}

/**
 * Answer GET /api/workspace-diff.changes.
 * @param ctx - host context.
 * @param request - the incoming request.
 * @returns the file list, or a refusal.
 */
async function changesResponse(ctx: Context, request: Request): Promise<Response> {
  const resolved = await sessionOf(ctx, request)
  if (resolved instanceof Response) return resolved
  if ('ok' in resolved) return json(resolved)

  const session = ctx.sessions.get(resolved.sessionId)
  const workspace = await readWorkspace(ctx, session, resolved.cwd, request.signal)
  if ('ok' in workspace) return json(workspace)
  return json({ ok: true, repoRoot: workspace.repoRoot, files: workspace.files })
}

/**
 * Answer GET /api/workspace-diff.diff.
 * @param ctx - host context.
 * @param request - the incoming request.
 * @returns the two sides of one accepted path's comparison, or a refusal.
 */
async function diffResponse(ctx: Context, request: Request): Promise<Response> {
  const path = new URL(request.url).searchParams.get('path')
  if (path === null || path === '') return new Response('path is required.', { status: 400 })

  const resolved = await sessionOf(ctx, request)
  if (resolved instanceof Response) return resolved
  if ('ok' in resolved) return json(resolved)

  const session = ctx.sessions.get(resolved.sessionId)
  const workspace = await readWorkspace(ctx, session, resolved.cwd, request.signal)
  if ('ok' in workspace) return json(workspace)

  // The path is only ever used after this status report named it.
  const file = workspace.files.find((entry) => entry.path === path)
  if (file === undefined) return json({ ok: false, reason: 'not-in-repo' } satisfies Failure)

  if (file.status !== 'D') {
    const size = await fileSize(ctx, session, workspace.repoRoot, path, request.signal)
    if (size !== undefined && size > FILE_MAX_BYTES) return json({ ok: false, reason: 'too-large' } satisfies Failure)
  }

  const untracked = file.status === '?'
  const command = untracked ? untrackedDiffCommand(path) : trackedDiffCommand(path, workspace.unborn)
  const result = await runGit(ctx, session, workspace.repoRoot, command, DIFF_MAX_BYTES, request.signal)
  const unified = result.stdout.text

  if (isBinaryDiff(unified)) return json({ ok: false, reason: 'binary' } satisfies Failure)
  // A no-index diff exits 1 when the files differ, which is the normal outcome for an untracked file.
  const expected = untracked ? (result.exitCode === 0 || result.exitCode === 1) : result.exitCode === 0
  if (!expected) return json({ ok: false, reason: 'not-in-repo' } satisfies Failure)

  return json({
    ok: true,
    path,
    hunks: parseUnifiedHunks(unified),
    added: file.added,
    removed: file.removed,
    truncated: result.stdout.truncated,
  })
}

/**
 * @param error - a thrown value.
 * @returns its code string, when it carries one.
 */
function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}
