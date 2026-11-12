import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { deriveBoard, derivePinned, previewMode, visibleCompleted, waitingCopyKey, type SessionCard } from '../src/client/board.ts'

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
  it('places a running Session in the running column only', () => {
    const session = id('running')
    const board = deriveBoard(
      listOf([summary('running')]),
      statusesOf([[session, status({ running: true })]]),
      [],
    )

    expect(idsOf(board.running)).toEqual([session])
    expect(board.waiting).toEqual([])
    expect(board.completed).toEqual([])
  })

  it('falls back to the list running flag while the status snapshot is unknown', () => {
    const session = id('early')
    const board = deriveBoard(listOf([summary('early', { running: true })]), new Map(), [])

    expect(idsOf(board.running)).toEqual([session])
  })

  it('lets a pending interaction outrank a running turn', () => {
    const session = id('approval')
    const board = deriveBoard(
      listOf([summary('approval')]),
      statusesOf([[session, status({ running: true, pendingInteraction: pending('approval', session) })]]),
      [],
    )

    expect(board.running).toEqual([])
    expect(board.waiting).toHaveLength(1)
    expect(board.waiting[0]).toMatchObject({ id: session, waitingKind: 'approval' })
  })

  it('places an unread completion in the completed column', () => {
    const session = id('done')
    const board = deriveBoard(
      listOf([summary('done')]),
      statusesOf([[session, status({ running: false, completionUnread: true })]]),
      [],
    )

    expect(idsOf(board.completed)).toEqual([session])
    expect(board.running).toEqual([])
    expect(board.waiting).toEqual([])
  })

  it('places a stop observed by the board in completed even without an unread marker', () => {
    const session = id('stopped')
    const board = deriveBoard(
      listOf([summary('stopped')]),
      statusesOf([[session, status({ running: false, completionUnread: false })]]),
      [],
      new Set([session]),
    )

    expect(idsOf(board.completed)).toEqual([session])
  })

  it('keeps running and waiting Sessions out of completed even when marked stopped', () => {
    const running = id('running')
    const waiting = id('waiting')
    const board = deriveBoard(
      listOf([summary('running'), summary('waiting')]),
      statusesOf([
        [running, status({ running: true })],
        [waiting, status({ pendingInteraction: pending('question', waiting) })],
      ]),
      [],
      new Set([running, waiting]),
    )

    expect(idsOf(board.running)).toEqual([running])
    expect(idsOf(board.waiting)).toEqual([waiting])
    expect(board.completed).toEqual([])
  })

  it('drops idle and already-read Sessions', () => {
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
    expect(board.waiting).toEqual([])
    expect(board.completed).toEqual([])
  })

  it('drops blank, subagent, archived, and unstatused rows', () => {
    const blank = summary('blank', { blank: true })
    const child = summary('child', { origin: 'subagent' })
    const archived = summary('archived')
    const unstatused = summary('unstatused')
    const normal = summary('normal')
    const rows = [blank, child, archived, unstatused, normal]
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
  })

  it('orders each column newest first with the Session id as a tie-break', () => {
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
  it('keeps pinned Sessions in pin order with their runtime state', () => {
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

describe('previewMode', () => {
  it('opens a waiting Session in the question dialog', () => {
    expect(previewMode('waiting')).toBe('dialog')
  })

  it('opens every other state in the full preview page', () => {
    expect(previewMode('running')).toBe('page')
    expect(previewMode('completed')).toBe('page')
    expect(previewMode('idle')).toBe('page')
  })
})

describe('visibleCompleted', () => {
  /** One completed card at a known activity time. */
  function card(name: string, updatedAt: number): SessionCard {
    return {
      id: id(name),
      title: name,
      cwd: undefined,
      updatedAt,
      waitingKind: undefined,
    }
  }

  it('hides a completion whose activity the preview already showed', () => {
    const done = card('done', 100)
    const readAt = new Map<SessionId, number>([[done.id, 100]])

    expect(visibleCompleted([done], readAt)).toEqual([])
  })

  it('keeps a completion newer than the preview mark', () => {
    const done = card('done', 100)
    const readAt = new Map<SessionId, number>([[done.id, 90]])

    expect(idsOf(visibleCompleted([done], readAt))).toEqual([done.id])
  })

  it('keeps completions the preview never showed', () => {
    const done = card('done', 100)

    expect(idsOf(visibleCompleted([done], new Map()))).toEqual([done.id])
  })

  it('hides only the marked card in a mixed column', () => {
    const older = card('older', 100)
    const newer = card('newer', 300)
    const readAt = new Map<SessionId, number>([[older.id, 100]])

    expect(idsOf(visibleCompleted([older, newer], readAt))).toEqual([newer.id])
  })

  it('keeps a locally observed completion even when an older read mark exists', () => {
    const done = card('done', 100)
    const readAt = new Map<SessionId, number>([[done.id, 100]])

    expect(idsOf(visibleCompleted([done], readAt, new Set([done.id])))).toEqual([done.id])
  })
})
