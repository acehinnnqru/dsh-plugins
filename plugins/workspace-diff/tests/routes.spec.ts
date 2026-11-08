import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { CHANGES_PATH, DIFF_PATH } from '../src/git.ts'
import { registerWorkspaceDiffRoutes } from '../src/routes.ts'

/** One route, as the stub Connection registry captured it. */
interface Route {
  path: string
  methods: readonly string[]
  requestBody: string
  fetch: (request: Request) => Promise<Response>
}

/** What the stub executor answers for one command. */
interface Answer {
  exitCode: number
  text: string
  truncated?: boolean
}

const PORCELAIN = '1 M. N... 100644 100644 100644 aaa bbb src/a.ts\0? notes/new file.txt\0'
const NUMSTAT = '2\t1\tsrc/a.ts\n'
const TRACKED_DIFF = 'diff --git a/src/a.ts b/src/a.ts\nindex 111..222 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n-old\n+new\n+more\n'
const UNTRACKED_DIFF = 'diff --git a/notes/new file.txt b/notes/new file.txt\nnew file mode 100644\n@@ -0,0 +1 @@\n+hello\n'

/**
 * @param command - the command the route built.
 * @returns a git-shaped answer for it.
 */
function defaultAnswers(command: string): Answer {
  if (command.includes('rev-parse --show-toplevel')) return { exitCode: 0, text: '/repo\n' }
  if (command.includes('rev-parse --verify HEAD')) return { exitCode: 0, text: 'abc123\n' }
  if (command.includes('status --porcelain=v2')) return { exitCode: 0, text: PORCELAIN }
  // The untracked pass is the same --numstat with a --no-index comparison, one file per command.
  if (command.includes('--no-index --numstat')) return { exitCode: 1, text: '1\t0\tnotes/new file.txt\n' }
  if (command.includes('--numstat')) return { exitCode: 0, text: NUMSTAT }
  if (command.startsWith('wc -c')) return { exitCode: 0, text: '12\n' }
  if (command.includes('--no-index')) return { exitCode: 1, text: UNTRACKED_DIFF }
  return { exitCode: 0, text: TRACKED_DIFF }
}

/**
 * Build a host context whose Connection, Session query, and executor are stubs.
 * @param overrides - cwd (null for a header without one), an unknown Session, or custom answers.
 * @returns the registered routes and every command the executor saw.
 */
/**
 * @param command - one command the executor was handed.
 * @returns true for a unified-diff call, as opposed to the status and counting calls.
 */
function isDiffCall(command: string): boolean {
  return command.includes(' diff ') && !command.includes('--numstat')
}

function harness(overrides: {
  cwd?: string | null
  unknown?: boolean
  answers?: (command: string) => Answer
} = {}): { routes: Map<string, Route>; calls: { command: string; workdir: string }[] } {
  const routes = new Map<string, Route>()
  const calls: { command: string; workdir: string }[] = []
  const answers = overrides.answers ?? defaultAnswers
  const cwd = overrides.cwd === undefined ? '/work' : overrides.cwd

  const ctx = {
    connection: {
      fetch: {
        register(route: Route) {
          routes.set(route.path, route)
          return () => Promise.resolve()
        },
      },
    },
    sessionQuery: {
      async readSession(id: string) {
        if (overrides.unknown === true) {
          const error = new Error('no such session') as Error & { code: string }
          error.code = 'SESSION_QUERY_SESSION_NOT_FOUND'
          throw error
        }
        return { session: cwd === null ? { id } : { id, cwd } }
      },
    },
    sessions: { get: () => undefined },
    sandboxPolicy: { resolve: () => ({ mode: 'read-only', root: '/work' }) },
    logger: { warn() {} },
    shell: {
      resolve(request: { command: string; workdir: string }) {
        return request
      },
      async execute(spec: { command: string; workdir: string }) {
        calls.push({ command: spec.command, workdir: spec.workdir })
        const answer = answers(spec.command)
        return {
          async result() {
            return {
              exitCode: answer.exitCode,
              signal: null,
              stdout: { text: answer.text, truncated: answer.truncated ?? false },
              stderr: { text: '', truncated: false },
            }
          },
        }
      },
    },
  } as unknown as Context

  registerWorkspaceDiffRoutes(ctx)
  return { routes, calls }
}

/**
 * Call one registered route.
 * @param routes - the registry the harness filled.
 * @param path - the full path plus query.
 * @returns the status and the decoded body (text when it is not JSON).
 */
async function call(routes: Map<string, Route>, path: string): Promise<{ status: number; body: unknown }> {
  const route = routes.get(path.split('?')[0] ?? path)
  if (route === undefined) throw new Error('route not registered: ' + path)
  const response = await route.fetch(new Request('http://localhost' + path))
  const text = await response.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body }
}

describe('workspace-diff routes', () => {
  it('lists the changed files with their counts', async () => {
    const { routes, calls } = harness()

    const { status, body } = await call(routes, CHANGES_PATH + '?sessionId=s1')

    expect(status).toBe(200)
    expect(body).toEqual({
      ok: true,
      repoRoot: '/repo',
      files: [
        { path: 'src/a.ts', status: 'M', added: 2, removed: 1 },
        { path: 'notes/new file.txt', status: '?', added: 1, removed: 0 },
      ],
    })
    // Every git call runs in the repository root, never in the Session's subdirectory.
    expect(calls.every((entry) => entry.workdir === '/repo' || entry.workdir === '/work')).toBe(true)
    expect(calls.some((entry) => entry.command.includes('status --porcelain=v2') && entry.workdir === '/repo')).toBe(true)
  })

  it('counts untracked files against the empty tree, and keeps a binary one unknown', async () => {
    const { routes, calls } = harness({
      answers: (command) => {
        if (command.includes('status --porcelain=v2')) return { exitCode: 0, text: '? notes/blob.bin\0? notes/new file.txt\0' }
        if (command.includes('--no-index --numstat')) {
          return { exitCode: 1, text: '-\t-\tnotes/blob.bin\n1\t0\tnotes/new file.txt\n' }
        }
        return defaultAnswers(command)
      },
    })

    const { body } = await call(routes, CHANGES_PATH + '?sessionId=s1')

    expect(body).toEqual({
      ok: true,
      repoRoot: '/repo',
      files: [
        { path: 'notes/blob.bin', status: '?', added: null, removed: null },
        { path: 'notes/new file.txt', status: '?', added: 1, removed: 0 },
      ],
    })
    // One command for the whole untracked pass, not one per file.
    expect(calls.filter((entry) => entry.command.includes('--no-index --numstat'))).toHaveLength(1)
  })

  it('answers no-cwd without running git at all', async () => {
    const { routes, calls } = harness({ cwd: null })

    const { body } = await call(routes, CHANGES_PATH + '?sessionId=s1')

    expect(body).toEqual({ ok: false, reason: 'no-cwd' })
    expect(calls).toEqual([])
  })

  it('answers not-a-repo and no-git from the root probe', async () => {
    const notARepo = harness({ answers: () => ({ exitCode: 128, text: 'fatal: not a git repository\n' }) })
    expect((await call(notARepo.routes, CHANGES_PATH + '?sessionId=s1')).body).toEqual({ ok: false, reason: 'not-a-repo' })

    const noGit = harness({ answers: () => ({ exitCode: 127, text: 'bash: git: command not found\n' }) })
    expect((await call(noGit.routes, CHANGES_PATH + '?sessionId=s1')).body).toEqual({ ok: false, reason: 'no-git' })
  })

  it('answers 404 for a Session the query engine does not know', async () => {
    const { routes } = harness({ unknown: true })

    expect((await call(routes, CHANGES_PATH + '?sessionId=missing')).status).toBe(404)
  })

  it('refuses a truncated status list instead of serving half of it', async () => {
    const { routes } = harness({
      answers: (command) => command.includes('status --porcelain=v2')
        ? { exitCode: 0, text: 'src/hal', truncated: true }
        : defaultAnswers(command),
    })

    expect((await call(routes, CHANGES_PATH + '?sessionId=s1')).body).toEqual({ ok: false, reason: 'truncated' })
  })

  it('never diffs a path the status report did not name', async () => {
    const { routes, calls } = harness()

    const { body } = await call(routes, DIFF_PATH + '?sessionId=s1&path=' + encodeURIComponent('../../etc/passwd'))

    expect(body).toEqual({ ok: false, reason: 'not-in-repo' })
    expect(calls.filter((entry) => isDiffCall(entry.command))).toEqual([])
  })

  it('serves an untracked file as numbered hunks with no counts row', async () => {
    const { routes, calls } = harness()

    const { body } = await call(routes, DIFF_PATH + '?sessionId=s1&path=' + encodeURIComponent('notes/new file.txt'))

    expect(body).toEqual({
      ok: true,
      path: 'notes/new file.txt',
      hunks: [{ header: '@@ -0,0 +1 @@', oldStart: 0, newStart: 1, lines: ['+hello'] }],
      added: 1,
      removed: 0,
      truncated: false,
    })
    const diff = calls.find((entry) => isDiffCall(entry.command))
    expect(diff?.command).toContain('--no-index')
    expect(diff?.workdir).toBe('/repo')
  })

  it('serves a tracked file as git hunks, with the counts the list already knows', async () => {
    const { routes, calls } = harness()

    const { body } = await call(routes, DIFF_PATH + '?sessionId=s1&path=src/a.ts')

    expect(body).toEqual({
      ok: true,
      path: 'src/a.ts',
      hunks: [{
        header: '@@ -1 +1,2 @@',
        oldStart: 1,
        newStart: 1,
        lines: ['-old', '+new', '+more'],
      }],
      added: 2,
      removed: 1,
      truncated: false,
    })
    const diff = calls.find((entry) => isDiffCall(entry.command))
    expect(diff?.command).toContain('-c core.quotepath=false')
    expect(diff?.command).toContain('--no-ext-diff --no-textconv')
    expect(diff?.command).toContain("'src/a.ts'")
  })

  it('answers a binary diff and a too-large file without serving hunks', async () => {
    const binary = harness({ answers: (command) => isDiffCall(command)
      ? { exitCode: 0, text: 'Binary files a/x and b/x differ\n' }
      : defaultAnswers(command) })
    expect((await call(binary.routes, DIFF_PATH + '?sessionId=s1&path=src/a.ts')).body)
      .toEqual({ ok: false, reason: 'binary' })

    const large = harness({ answers: (command) => command.startsWith('wc -c')
      ? { exitCode: 0, text: '99999999\n' }
      : defaultAnswers(command) })
    const { body } = await call(large.routes, DIFF_PATH + '?sessionId=s1&path=src/a.ts')
    expect(body).toEqual({ ok: false, reason: 'too-large' })
    expect(large.calls.filter((entry) => isDiffCall(entry.command))).toEqual([])
  })

  it('marks a diff the executor had to cut instead of failing', async () => {
    const { routes } = harness({ answers: (command) => isDiffCall(command)
      ? { exitCode: 0, text: TRACKED_DIFF, truncated: true }
      : defaultAnswers(command) })

    const { body } = await call(routes, DIFF_PATH + '?sessionId=s1&path=src/a.ts')
    expect(body).toMatchObject({ ok: true, truncated: true })
  })
})
