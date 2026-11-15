import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { StatusCoordinator } from '../src/network/status.ts'
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

/** A source with no Sessions unless the test supplies rows. */
function coordinator(items: readonly SessionSummary[] = []): {
  status: StatusCoordinator
  published: StatusPublishFrame[]
  reads: string[]
  states: string[]
} {
  const published: StatusPublishFrame[] = []
  const reads: string[] = []
  const states: string[] = []
  const status = new StatusCoordinator({
    list: async () => ({ items }),
    state: async (sessionId) => {
      states.push(sessionId)
      return { running: false, pendingInput: [] }
    },
  }, () => {})
  status.setPublisher({
    publish: (frame) => published.push(frame),
    read: (sessionId) => reads.push(sessionId),
  })
  return { status, published, reads, states }
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
    const { status, published, reads, states } = coordinator([remoteSummary(remote)])
    status.applyServer([record({ sessionId: remote, ownerNodeId: 'nd_b', unread: true, readAt: 0 })])

    status.start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    status.stop()
    expect(states).toEqual([])
    expect(published).toEqual([])

    status.markRead(remote)
    expect(reads).toEqual([remote])
    expect(published).toEqual([])

    await status.reportUnread(remote, 100)
    expect(published).toEqual([])
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
