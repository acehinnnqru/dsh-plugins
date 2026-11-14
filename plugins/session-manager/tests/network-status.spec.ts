import { describe, expect, it } from 'vitest'
import { StatusCoordinator } from '../src/network/status.ts'
import type { SessionStatusRecord, StatusPublishFrame } from '../src/network/protocol.ts'

/** A source with no Sessions; tests drive events and server rows directly. */
function coordinator(): { status: StatusCoordinator; published: StatusPublishFrame[]; reads: string[] } {
  const published: StatusPublishFrame[] = []
  const reads: string[] = []
  const status = new StatusCoordinator({
    list: async () => ({ items: [] }),
    state: async () => ({ running: false, pendingInput: [] }),
  }, () => {})
  status.setPublisher({
    publish: (frame) => published.push(frame),
    read: (sessionId) => reads.push(sessionId),
  })
  return { status, published, reads }
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
