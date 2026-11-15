import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  deriveBoard,
  deriveNodeColumns,
  derivePinned,
  previewReadMark,
  waitingCopyKey,
  withinRecent,
  type SessionCard,
} from '../src/client/board.ts'

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

/** The ids a column carries, in render order. */
function idsOf(cards: readonly { readonly id: SessionId }[]): SessionId[] {
  return cards.map((card) => card.id)
}

/** A pending interaction of one runtime kind. */
function pending(kind: string, sessionId: SessionId): NonNullable<SessionStatus['pendingInteraction']> {
  return { key: `test-${kind}`, kind, sessionId }
}

describe('deriveBoard', () => {
  it('groups cards by owning node and keeps pins at the top of each column', () => {
    const local = id('local-node')
    const remote = id('remote-node')
    const list = listOf([
      summary('local-node', { updatedAt: 10 }),
      summary('remote-node', { displayTitle: '[node-b] remote-node', updatedAt: 20 }),
    ])
    list.projectionsBySession[remote] = {
      values: { sessionManagerNode: { nodeId: 'nd_b', name: 'node-b' } },
      state: 'ready',
      error: null,
    } as never

    const columns = deriveNodeColumns(list, new Map(), [], [remote])
    expect(columns.map((column) => column.node.name)).toEqual(['self', 'node-b'])
    expect(columns[0]?.rest.map((card) => card.id)).toEqual([local])
    expect(columns[1]?.pinned.map((card) => card.id)).toEqual([remote])
    expect(columns[1]?.pinned[0]?.title).toBe('remote-node')
  })

  it('lets the shared status override a local unread completion in both directions', () => {
    const session = id('shared')
    const list = listOf([summary('shared')])
    const read = new Map([[session as string, { sessionId: session, running: false, pending: null, unread: false, updatedAt: 1, readAt: 2 }]])
    const cleared = deriveBoard(list, statusesOf([[session, status({ completionUnread: true })]]), [], new Set(), new Map(), read)
    expect(idsOf(cleared.recent)).toEqual([session])

    const unread = new Map([[session as string, { sessionId: session, running: false, pending: null, unread: true, updatedAt: 1, readAt: 0 }]])
    const shown = deriveBoard(list, statusesOf([[session, status()]]), [], new Set(), new Map(), unread)
    expect(idsOf(shown.unread)).toEqual([session])
  })

  it('places a running Session in the running column only', () => {
    const session = id('running')
    const board = deriveBoard(
      listOf([summary('running')]),
      statusesOf([[session, status({ running: true })]]),
      [],
    )

    expect(idsOf(board.running)).toEqual([session])
    expect(board.unread).toEqual([])
    expect(board.recent).toEqual([])
  })

  it('falls back to the list running flag while the status snapshot is unknown', () => {
    const session = id('early')
    const board = deriveBoard(listOf([summary('early', { running: true })]), new Map(), [])

    expect(idsOf(board.running)).toEqual([session])
  })

  it('uses the shared status for running and waiting', () => {
    const running = id('remote-running')
    const waiting = id('remote-waiting')
    const list = listOf([summary('remote-running'), summary('remote-waiting')])
    const shared = new Map([
      [running as string, { sessionId: running, running: true, pending: null, unread: false, updatedAt: 1, readAt: 0 }],
      [waiting as string, { sessionId: waiting, running: false, pending: 'approval', unread: true, updatedAt: 1, readAt: 0 }],
    ])

    const board = deriveBoard(list, new Map(), [], new Set(), new Map(), shared)
    expect(idsOf(board.running)).toEqual([running])
    expect(idsOf(board.unread)).toEqual([waiting])
    expect(board.unread[0]?.waitingKind).toBe('approval')
  })

  it('lets a pending interaction outrank a running turn', () => {
    const session = id('approval')
    const board = deriveBoard(
      listOf([summary('approval')]),
      statusesOf([[session, status({ running: true, pendingInteraction: pending('approval', session) })]]),
      [],
    )

    expect(board.running).toEqual([])
    expect(board.unread).toHaveLength(1)
    expect(board.unread[0]).toMatchObject({ id: session, waitingKind: 'approval' })
    expect(board.recent).toEqual([])
  })

  it('places an unread completion in the unread column', () => {
    const session = id('done')
    const board = deriveBoard(
      listOf([summary('done')]),
      statusesOf([[session, status({ running: false, completionUnread: true })]]),
      [],
    )

    expect(idsOf(board.unread)).toEqual([session])
    expect(board.running).toEqual([])
    expect(board.recent).toEqual([])
  })

  it('places a stop observed by the board in unread even without an unread marker', () => {
    const session = id('stopped')
    const board = deriveBoard(
      listOf([summary('stopped')]),
      statusesOf([[session, status({ running: false, completionUnread: false })]]),
      [],
      new Set([session]),
    )

    expect(idsOf(board.unread)).toEqual([session])
  })

  it('uses running before a stale completion and unread before a running pending row', () => {
    const running = id('running')
    const waiting = id('waiting')
    const board = deriveBoard(
      listOf([summary('running'), summary('waiting')]),
      statusesOf([
        [running, status({ running: true, completionUnread: true })],
        [waiting, status({ running: true, pendingInteraction: pending('question', waiting) })],
      ]),
      [],
      new Set([running, waiting]),
    )

    expect(idsOf(board.running)).toEqual([running])
    expect(idsOf(board.unread)).toEqual([waiting])
    expect(board.recent).toEqual([])
  })

  it('keeps idle and already-read Sessions in recent', () => {
    const read = id('read')
    const idle = id('idle')
    const board = deriveBoard(
      listOf([summary('read'), summary('idle')]),
      statusesOf([
        [read, status({ running: false, completionUnread: false })],
        [idle, status()],
      ]),
      [],
    )

    expect(board.running).toEqual([])
    expect(board.unread).toEqual([])
    expect([...idsOf(board.recent)].sort()).toEqual(['idle', 'read'])
  })

  it('moves an unread completion to recent when a current read mark exists', () => {
    const done = id('done')
    const board = deriveBoard(
      listOf([summary('done')]),
      statusesOf([[done, status({ completionUnread: true })]]),
      [],
      new Set(),
      new Map([[done, 1]]),
    )

    expect(idsOf(board.recent)).toEqual([done])
    expect(board.unread).toEqual([])
  })

  it('keeps an unread completion in unread when the read mark is older', () => {
    const done = id('done')
    const board = deriveBoard(
      listOf([summary('done')]),
      statusesOf([[done, status({ completionUnread: true })]]),
      [],
      new Set(),
      new Map([[done, 0]]),
    )

    expect(idsOf(board.unread)).toEqual([done])
    expect(board.recent).toEqual([])
  })

  it('drops blank, subagent, and archived rows', () => {
    const blank = summary('blank', { blank: true })
    const child = summary('child', { origin: 'subagent' })
    const archived = summary('archived')
    const normal = summary('normal')
    const rows = [blank, child, archived, normal]
    const board = deriveBoard(
      listOf(rows),
      statusesOf([
        [blank.id, status({ running: true })],
        [child.id, status({ running: true })],
        [archived.id, status({ running: true })],
        [normal.id, status({ running: true })],
      ]),
      [archived.id],
    )

    expect(idsOf(board.running)).toEqual([normal.id])
    expect(board.recent).toEqual([])
  })

  it('orders running newest first with the Session id as a tie-break', () => {
    const older = summary('a', { updatedAt: 100 })
    const newerB = summary('b', { updatedAt: 300 })
    const newerC = summary('c', { updatedAt: 300 })
    const statuses = statusesOf([
      [older.id, status({ running: true })],
      [newerB.id, status({ running: true })],
      [newerC.id, status({ running: true })],
    ])
    const board = deriveBoard(listOf([older, newerB, newerC]), statuses, [])

    expect(idsOf(board.running)).toEqual([newerB.id, newerC.id, older.id])
  })

  it('orders recent newest first with the Session id as a tie-break', () => {
    const older = summary('a', { updatedAt: 100 })
    const newerB = summary('b', { updatedAt: 300 })
    const newerC = summary('c', { updatedAt: 300 })
    const statuses = statusesOf([
      [older.id, status()],
      [newerB.id, status()],
      [newerC.id, status()],
    ])
    const board = deriveBoard(listOf([older, newerB, newerC]), statuses, [])

    expect(idsOf(board.recent)).toEqual([newerB.id, newerC.id, older.id])
  })

  it('carries the display title and working directory onto a card', () => {
    const session = id('titled')
    const board = deriveBoard(
      listOf([summary('titled', { displayTitle: 'Fix the parser', cwd: '/work/repo' })]),
      statusesOf([[session, status({ running: true })]]),
      [],
    )

    expect(board.running[0]).toMatchObject({
      id: session,
      title: 'Fix the parser',
      cwd: '/work/repo',
    })
  })

  it('maps every shipped interaction kind and falls back for unknown ones', () => {
    expect(waitingCopyKey('approval')).toBe('waiting.approval')
    expect(waitingCopyKey('plan-review')).toBe('waiting.planReview')
    expect(waitingCopyKey('question')).toBe('waiting.question')
    expect(waitingCopyKey('background-job')).toBe('waiting.input')
    expect(waitingCopyKey(undefined)).toBe('waiting.input')
  })
})

describe('derivePinned', () => {
  it('keeps pinned Sessions in Host pin order with their runtime state', () => {
    const running = id('running')
    const waiting = id('waiting')
    const done = id('done')
    const idle = id('idle')
    const pinned = derivePinned(
      listOf([summary('running'), summary('waiting'), summary('done'), summary('idle')]),
      statusesOf([
        [running, status({ running: true })],
        [waiting, status({ pendingInteraction: pending('question', waiting) })],
        [done, status({ completionUnread: true })],
        [idle, status()],
      ]),
      [],
      [idle, done, running, waiting],
    )

    expect(pinned.map((card) => [card.id, card.state])).toEqual([
      [idle, 'idle'],
      [done, 'completed'],
      [running, 'running'],
      [waiting, 'waiting'],
    ])
  })

  it('turns a read completion into idle but keeps a locally observed stop', () => {
    const done = id('done')
    const local = id('local')
    const list = listOf([summary('done'), summary('local')])
    const statuses = statusesOf([
      [done, status({ completionUnread: true })],
      [local, status()],
    ])
    const readAt = new Map<SessionId, number>([[done, 1], [local, 1]])

    const pinned = derivePinned(list, statuses, [], [done, local], readAt, new Set([local]))

    expect(pinned.map((card) => [card.id, card.state])).toEqual([
      [done, 'idle'],
      [local, 'completed'],
    ])
  })

  it('skips archived, blank, and subagent pinned rows', () => {
    const normal = summary('normal')
    const blank = summary('blank', { blank: true })
    const child = summary('child', { origin: 'subagent' })
    const archived = summary('archived')
    const pinned = derivePinned(
      listOf([normal, blank, child, archived]),
      statusesOf([[normal.id, status({ running: true })]]),
      [archived.id],
      [blank.id, child.id, archived.id, normal.id],
    )

    expect(pinned.map((card) => card.id)).toEqual([normal.id])
  })
})

describe('previewReadMark', () => {
  it('records the row once a previewed Session reports an unread completion', () => {
    const session = id('shown')
    const list = listOf([summary('shown', { updatedAt: 40 })])
    const statuses = statusesOf([[session, status({ completionUnread: true })]])

    expect(previewReadMark(list, statuses, session, new Map())).toBe(40)
  })

  it('leaves an acknowledged completion alone', () => {
    const session = id('shown')
    const list = listOf([summary('shown', { updatedAt: 40 })])
    const statuses = statusesOf([[session, status({ completionUnread: true })]])
    const readAt = new Map<SessionId, number>([[session, 40]])

    expect(previewReadMark(list, statuses, session, readAt)).toBeUndefined()
  })

  it('ignores a Session with no unread completion or no row', () => {
    const session = id('shown')
    const list = listOf([summary('shown', { updatedAt: 40 })])

    expect(previewReadMark(list, statusesOf([[session, status()]]), session, new Map())).toBeUndefined()
    expect(previewReadMark(list, statusesOf([]), id('gone'), new Map())).toBeUndefined()
  })
})

describe('withinRecent', () => {
  const day = 86_400_000

  function card(name: string, updatedAt: number): SessionCard {
    return {
      id: id(name),
      title: name,
      cwd: undefined,
      updatedAt,
      waitingKind: undefined,
      node: { id: undefined, name: 'self', self: true },
    }
  }

  it('keeps the inclusive window and drops older cards', () => {
    const now = 10 * day
    const inside = card('inside', now - 3 * day)
    const older = card('older', now - 3 * day - 1)

    expect(idsOf(withinRecent([inside, older], now, 3))).toEqual([inside.id])
  })

  it('uses the selected window', () => {
    const now = 10 * day
    const week = card('week', now - 7 * day)

    expect(idsOf(withinRecent([week], now, 7))).toEqual([week.id])
    expect(withinRecent([week], now, 3)).toEqual([])
  })
})
