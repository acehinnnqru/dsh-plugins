import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { matchSessions, searchableSessions, type SessionHit } from '../src/client/session-search.ts'
import { DEFAULT_WORKSPACE_TITLE } from '../src/client/workspace-search.ts'

/**
 * The search dialog's pure half.
 *
 * The dialog owns the field and the keyboard; these tests cover the full-list derivation and the
 * title-or-Workspace filter it feeds from that field.
 */

/** Brand a literal string as a Session id. */
function id(value: string): SessionId {
  return value as SessionId
}

/** One list row with every required field filled in. */
function summary(name: string, overrides: Partial<Omit<SessionSummary, 'id'>> = {}): SessionSummary {
  return {
    id: id(name),
    displayTitle: name,
    running: false,
    retainedBy: {},
    blank: false,
    updatedAt: 1,
    ...overrides,
  }
}

/** A list snapshot over the given rows. */
function listOf(rows: readonly SessionSummary[]): SessionListState {
  const byId: Record<SessionId, SessionSummary> = {}
  for (const row of rows) byId[row.id] = row
  return {
    ids: rows.map((row) => row.id),
    byId,
    phase: 'ready',
    projectionsBySession: {},
  }
}

/** A status with every fact absent unless the test supplies it. */
function status(overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    running: undefined,
    pendingInteraction: undefined,
    completionUnread: false,
    ...overrides,
  }
}

/** Index statuses by Session. */
function statusesOf(entries: ReadonlyArray<readonly [SessionId, SessionStatus]>): SessionStatusSnapshot {
  return new Map(entries)
}

/** A pending interaction of one runtime kind. */
function pending(kind: string, sessionId: SessionId): NonNullable<SessionStatus['pendingInteraction']> {
  return { key: `test-${kind}`, kind, sessionId }
}

/** The ids a hit list carries, in render order. */
function idsOf(hits: readonly { readonly id: SessionId }[]): SessionId[] {
  return hits.map((hit) => hit.id)
}

describe('searchableSessions', () => {
  it('keeps every listed Session, including one outside the Recent window', () => {
    const recent = summary('recent', { updatedAt: 900 })
    const old = summary('old', { updatedAt: 1 })
    const hits = searchableSessions(
      listOf([old, recent]),
      statusesOf([[recent.id, status()], [old.id, status()]]),
      [],
    )

    expect(idsOf(hits)).toEqual([recent.id, old.id])
  })

  it('drops blank, subagent, and archived rows', () => {
    const blank = summary('blank', { blank: true })
    const child = summary('child', { origin: 'subagent' })
    const archived = summary('archived')
    const normal = summary('normal')
    const hits = searchableSessions(
      listOf([blank, child, archived, normal]),
      statusesOf([
        [blank.id, status({ running: true })],
        [child.id, status({ running: true })],
        [archived.id, status({ running: true })],
        [normal.id, status({ running: true })],
      ]),
      [archived.id],
    )

    expect(idsOf(hits)).toEqual([normal.id])
  })

  it('orders newest first with the Session id as a tie-break', () => {
    const older = summary('a', { updatedAt: 100 })
    const newerB = summary('b', { updatedAt: 300 })
    const newerC = summary('c', { updatedAt: 300 })
    const hits = searchableSessions(
      listOf([older, newerB, newerC]),
      statusesOf([[older.id, status()], [newerB.id, status()], [newerC.id, status()]]),
      [],
    )

    expect(idsOf(hits)).toEqual([newerB.id, newerC.id, older.id])
  })

  it('carries the runtime state the preview opens with', () => {
    const waiting = summary('waiting')
    const running = summary('running')
    const done = summary('done')
    const idle = summary('idle')
    const hits = searchableSessions(
      listOf([waiting, running, done, idle]),
      statusesOf([
        [waiting.id, status({ pendingInteraction: pending('question', waiting.id) })],
        [running.id, status({ running: true })],
        [done.id, status({ completionUnread: true })],
        [idle.id, status()],
      ]),
      [],
    )

    // Every row shares one activity time, so the id is the tie-break.
    expect(hits.map((hit) => [hit.id, hit.state])).toEqual([
      [done.id, 'completed'],
      [idle.id, 'idle'],
      [running.id, 'running'],
      [waiting.id, 'waiting'],
    ])
    expect(hits.find((hit) => hit.id === waiting.id)?.waitingKind).toBe('question')
  })

  it('falls back to the list running flag before the status snapshot knows a row', () => {
    const early = summary('early', { running: true })
    const hits = searchableSessions(listOf([early]), new Map(), [])

    expect(hits[0]?.state).toBe('running')
  })

  it('turns a read completion into idle but keeps a locally observed stop', () => {
    const read = summary('read')
    const local = summary('local')
    const hits = searchableSessions(
      listOf([read, local]),
      statusesOf([[read.id, status({ completionUnread: true })], [local.id, status()]]),
      [],
      new Map([[read.id, 1], [local.id, 1]]),
      new Set([local.id]),
    )

    expect(hits.map((hit) => [hit.id, hit.state])).toEqual([
      [local.id, 'completed'],
      [read.id, 'idle'],
    ])
  })

  it('carries the title and working directory onto a hit', () => {
    const session = id('titled')
    const hits = searchableSessions(
      listOf([summary('titled', { displayTitle: 'Fix the parser', cwd: '/work/repo' })]),
      statusesOf([[session, status({ running: true })]]),
      [],
    )

    expect(hits[0]).toMatchObject({
      id: session,
      title: 'Fix the parser',
      cwd: '/work/repo',
    })
  })
})

/** One Workspace row owning the given Sessions. */
function workspace(title: string, path: string, sessionIds: readonly SessionId[]): WorkspaceView {
  return {
    workspaceId: path,
    title,
    path,
    sessionIds,
    createdAt: new Date(1_000).toISOString(),
    updatedAt: new Date(1_000).toISOString(),
  } as unknown as WorkspaceView
}

/** A named Workspace owning two Sessions whose titles never mention it. */
const PLUGINS = workspace('dsh-plugins', '/work/dsh-plugins', [id('alpha'), id('beta')])
/** The product's default Workspace: its stored title is the marker, not the project name. */
const DEFAULT = workspace(DEFAULT_WORKSPACE_TITLE, '/home/me/monorepo', [id('gamma')])

describe('matchSessions', () => {
  const hits = [
    { id: id('alpha'), title: 'Release checklist', cwd: '/work/alpha', updatedAt: 3, waitingKind: undefined, state: 'idle' },
    { id: id('beta'), title: 'PARSER rewrite', cwd: '/work/beta', updatedAt: 2, waitingKind: undefined, state: 'running' },
    { id: id('gamma'), title: 'Parser notes', cwd: '/home/me/monorepo', updatedAt: 1, waitingKind: undefined, state: 'idle' },
  ] satisfies SessionHit[]

  it('keeps the given order for an empty query', () => {
    expect(matchSessions(hits, '')).toBe(hits)
    expect(matchSessions(hits, '   ')).toBe(hits)
  })

  it('matches a title case-insensitively', () => {
    expect(idsOf(matchSessions(hits, 'parser'))).toEqual([id('beta'), id('gamma')])
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(idsOf(matchSessions(hits, '  release '))).toEqual([id('alpha')])
  })

  it('matches a substring in the middle of a title', () => {
    expect(idsOf(matchSessions(hits, 'check'))).toEqual([id('alpha')])
  })

  it('matches every Session of a Workspace by its name', () => {
    // Alpha and Beta live in `dsh-plugins`; neither title names it.
    expect(idsOf(matchSessions(hits, 'dsh-plugins', [PLUGINS]))).toEqual([id('alpha'), id('beta')])
  })

  it('matches the default Workspace by its directory name', () => {
    // The default Workspace's label is the product marker, so the directory names the project.
    expect(idsOf(matchSessions(hits, 'monorepo', [DEFAULT]))).toEqual([id('gamma')])
  })

  it('does not match a Session or Workspace path', () => {
    expect(matchSessions(hits, '/work/dsh-plugins', [PLUGINS, DEFAULT])).toEqual([])
    expect(matchSessions(hits, '/home/me/monorepo', [PLUGINS, DEFAULT])).toEqual([])
  })

  it('returns nothing when no title or Workspace matches', () => {
    expect(matchSessions(hits, 'missing', [PLUGINS, DEFAULT])).toEqual([])
  })
})
