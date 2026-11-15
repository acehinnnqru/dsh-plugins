import { describe, expect, it, vi } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { StatusCoordinator, type StatusChange } from '../src/network/status.ts'
import type { SessionStatusRecord, StatusPublishFrame } from '../src/network/protocol.ts'

/** One federated row owned by another node. */
function remoteSummary(sessionId: SessionId): SessionSummary {
  return {
    agentAvailable: true,
    sessionId,
    updatedAt: 100,
    running: false,
    blank: false,
    projections: {
      kind: 'cached',
      asOfSeq: 0,
      values: { sessionManagerNode: { nodeId: 'nd_b', name: 'node-b' } },
    },
  }
}

/** One local list row. */
function summary(sessionId: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    agentAvailable: true,
    sessionId: sessionId as SessionId,
    updatedAt: 100,
    running: false,
    blank: false,
    ...overrides,
  }
}

/** A coordinator over a mutable listing and an in-memory pending registry. */
function coordinator(items: readonly SessionSummary[] = [], changes: StatusChange[] = []): {
  status: StatusCoordinator
  published: StatusPublishFrame[]
  reads: string[]
  pending: Map<string, readonly string[]>
  rows: SessionSummary[]
  lists: () => number
} {
  const published: StatusPublishFrame[] = []
  const reads: string[] = []
  const pending = new Map<string, readonly string[]>()
  const rows = [...items]
  let lists = 0
  const status = new StatusCoordinator({
    list: async () => {
      lists += 1
      return { items: rows }
    },
    pending: () => pending,
  }, () => {}, (change) => {
    changes.push(change)
  })
  status.setPublisher({
    publish: (frame) => published.push(frame),
    read: (sessionId) => reads.push(sessionId),
  })
  return { status, published, reads, pending, rows, lists: () => lists }
}

/** One server row. */
function record(overrides: Partial<SessionStatusRecord> = {}): SessionStatusRecord {
  return {
    sessionId: 'session',
    ownerNodeId: 'node',
    running: false,
    pending: null,
    unread: false,
    updatedAt: 100,
    readAt: 0,
    revision: 1,
    ...overrides,
  }
}

/** Let the boot baseline settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('StatusCoordinator', () => {
  it('turns a local stop into unread and clears it on read', () => {
    const { status, published } = coordinator()
    status.onRunning('session', true)
    status.onRunning('session', false)
    expect(published.at(-1)?.unread).toBe(true)

    status.markRead('session' as never)
    expect(published.at(-1)?.unread).toBe(false)
  })

  it('keeps a server read acknowledgement and exposes it in snapshots', () => {
    const { status } = coordinator()
    status.applyServer([record({ unread: true, readAt: 0 })])
    expect(status.snapshot().find((row) => row.sessionId === 'session')?.unread).toBe(true)

    status.applyServer([record({ unread: false, readAt: 200 })])
    expect(status.snapshot().find((row) => row.sessionId === 'session')?.unread).toBe(false)
  })

  it('sends a read to the server for a remote Session', () => {
    const { status, reads } = coordinator()
    status.applyServer([record()])
    status.markRead('session' as never)
    expect(reads).toEqual(['session'])
  })

  it('leaves federated rows to their owner', async () => {
    const remote = 'remote' as SessionId
    const { status, published, reads, lists } = coordinator([remoteSummary(remote)])
    status.applyServer([record({ sessionId: remote, ownerNodeId: 'nd_b', unread: true, readAt: 0 })])

    status.start()
    await settle()
    status.stop()
    expect(lists()).toBe(1)
    expect(published).toEqual([])

    status.markRead(remote)
    expect(reads).toEqual([remote])
    expect(published).toEqual([])

    await status.reportUnread(remote, 100)
    expect(published).toEqual([])
  })

  it('lists storage once for the boot baseline and never on a timer', async () => {
    const { status, lists } = coordinator([summary('session')])
    status.start()
    await settle()
    await new Promise((resolve) => setTimeout(resolve, 50))
    status.stop()
    expect(lists()).toBe(1)
  })

  it('applies live rows, activity, and disposal without listing', async () => {
    const { status, published, lists } = coordinator()
    status.onAdded(summary('session', { running: true }))
    expect(status.snapshot().find((row) => row.sessionId === 'session')).toMatchObject({ running: true })

    status.onActivity('session', 500)
    expect(status.snapshot().find((row) => row.sessionId === 'session')?.updatedAt).toBe(500)

    status.onRemoved('session')
    expect(status.snapshot().find((row) => row.sessionId === 'session')).toMatchObject({ running: false })
    expect(status.snapshot().some((row) => row.sessionId === 'session')).toBe(true)
    expect(lists()).toBe(0)
    expect(published.length).toBeGreaterThan(0)
  })

  it('publishes pending input from the memory registry', async () => {
    vi.useFakeTimers()
    try {
      const { status, published, pending } = coordinator()
      status.start()
      await vi.advanceTimersByTimeAsync(0)
      status.onAdded(summary('session'))

      pending.set('session', ['approval'])
      await vi.advanceTimersByTimeAsync(1_000)
      expect(published.at(-1)?.pending).toBe('approval')

      pending.delete('session')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(published.at(-1)?.pending).toBe(null)
      status.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never keeps a local row for a federated identity', () => {
    const { status, published } = coordinator()
    status.noteFederated('remote')

    status.onRunning('remote', true)
    status.onActivity('remote', 50)
    status.onRemoved('remote')
    expect(published).toEqual([])
    expect(status.snapshot().some((row) => row.sessionId === 'remote')).toBe(false)

    status.forgetFederated('remote')
    status.onAdded(summary('remote'))
    expect(status.snapshot().some((row) => row.sessionId === 'remote')).toBe(true)
  })

  it('drops a local row that turns out to be federated', () => {
    const { status } = coordinator()
    status.onAdded(summary('shared'))
    expect(status.snapshot().some((row) => row.sessionId === 'shared')).toBe(true)

    status.noteFederated('shared')
    expect(status.snapshot().some((row) => row.sessionId === 'shared')).toBe(false)
  })

  it('ignores an unread report and a listing row for a federated identity', async () => {
    const { status, published } = coordinator([summary('remote')])
    status.noteFederated('remote')
    status.start()
    await status.reconcile()
    await status.reportUnread('remote' as never, 100)
    status.stop()
    expect(published.some((frame) => frame.sessionId === 'remote')).toBe(false)
  })

  it('reports a row a later reconcile discovers', async () => {
    const changes: StatusChange[] = []
    const { status, rows } = coordinator([summary('early')], changes)
    status.start()
    await status.reconcile()
    // The boot baseline reports nothing: the browser lists storage itself.
    expect(changes).toEqual([])

    rows.push(summary('late'))
    await status.reconcile()
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: 'added' })
    if (changes[0]?.kind === 'added') expect(changes[0].summary.sessionId).toBe('late')
    status.stop()
  })

  it('drops a row only after two listings miss it', async () => {
    const changes: StatusChange[] = []
    const { status, rows } = coordinator([summary('gone')], changes)
    status.start()
    await status.reconcile()
    rows.length = 0
    await status.reconcile()
    expect(changes).toEqual([])
    await status.reconcile()
    expect(changes).toEqual([{ kind: 'removed', sessionId: 'gone' }])
    status.stop()
  })

  it('imports an unread completion the baseline found', async () => {
    const { status, published } = coordinator([summary('session')])
    status.start()
    await status.reconcile()
    await status.reportUnread('session' as never, 100)
    expect(published.at(-1)).toMatchObject({ sessionId: 'session', unread: true })
    status.stop()
  })

  it('does not list storage for an unread report the baseline never saw', async () => {
    const { status, published, lists } = coordinator([summary('session')])
    status.start()
    await status.reconcile()
    await status.reportUnread('gone' as never, 100)
    status.stop()
    expect(lists()).toBe(1)
    expect(published.some((frame) => frame.sessionId === 'gone')).toBe(false)
  })

  it('ignores an old browser unread report after a read', async () => {
    const { status, published } = coordinator()
    status.onRunning('session', true)
    status.onRunning('session', false)
    const before = published.length
    status.applyServer([record({ unread: false, readAt: 200 })])
    await status.reportUnread('session' as never, 100)
    expect(published).toHaveLength(before)
  })
})
