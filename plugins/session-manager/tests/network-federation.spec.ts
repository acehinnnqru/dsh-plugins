import { describe, expect, it } from 'vitest'
import type { SessionControlFrame, SessionFollowFrame, SessionFollowRequest, SessionListRequest, SessionListValue, SessionPromptRequest, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { installFederation } from '../src/network/federation.ts'
import type { PeerPool } from '../src/network/peer-client.ts'
import type { PeerInfo } from '../src/network/protocol.ts'

/** One summary row. */
function summary(sessionId: SessionId, title: string): SessionSummary {
  return {
    agentAvailable: true,
    sessionId,
    updatedAt: 1,
    running: false,
    blank: false,
    cwd: 'source',
    projections: { kind: 'sequenced', asOfSeq: 0, values: { title } },
  }
}

/** One opening frame. */
function snapshot(sessionId: SessionId): SessionFollowFrame {
  return {
    type: 'snapshot',
    header: { version: 1, id: sessionId, createdAt: 1, isSeeded: false },
    cursor: 0,
    records: [],
    hasMore: false,
    projections: { asOfSeq: 0, values: {} },
  }
}

/** Fake local controller. */
class FakeController {
  async list(_request: SessionListRequest): Promise<SessionListValue> {
    return { items: [summary('local' as SessionId, 'local')] }
  }

  async *follow(request: SessionFollowRequest): AsyncIterable<SessionFollowFrame> {
    const id = request.address.kind === 'session' ? request.address.sessionId : ('local' as SessionId)
    yield snapshot(id)
  }

  async prompt(request: SessionPromptRequest): Promise<{ accepted: true }> {
    return { accepted: request.sessionId === 'local' }
  }

  async *control(): AsyncIterable<SessionControlFrame> {
    yield {
      type: 'baseline',
      value: { projections: { local: { asOfSeq: 0, values: { running: false } } } },
    } as SessionControlFrame
    yield {
      type: 'projection',
      sessionId: 'local',
      seq: 1,
      changes: [{ key: 'running', val: true }],
    } as SessionControlFrame
  }
}

describe('host session federation', () => {
  it('merges remote rows and routes remote calls to the peer link', async () => {
    const peer: PeerInfo = {
      nodeId: 'nd_b',
      name: 'node-b',
      encKey: 'enc',
      signKey: 'sign',
      online: true,
      lastSeen: 0,
      instanceId: 'nid_' + 'b'.repeat(64),
    }
    const remoteId = 'remote' as SessionId
    const requests: string[] = []
    const link = {
      async request(op: string): Promise<unknown> {
        requests.push(op)
        return { accepted: true }
      },
      async *stream(): AsyncIterable<unknown> {
        yield snapshot(remoteId)
      },
    }
    const pool = {
      directory: () => [peer],
      sessions: async () => [summary(remoteId, 'remote')],
      link: () => link,
    } as unknown as PeerPool

    const controller = new FakeController()
    const dispose = installFederation(controller, pool)

    const listed = await controller.list({})
    expect(listed.items.map((item) => item.sessionId)).toEqual(['local', remoteId])
    const remote = listed.items.find((item) => item.sessionId === remoteId)
    const remoteValues = remote?.projections?.values as Record<string, unknown> | undefined
    expect(remoteValues?.['title']).toBe('[node-b] remote')
    expect(remoteValues?.['sessionManagerNode']).toEqual({
      nodeId: 'nd_b',
      name: 'node-b',
      instanceId: 'nid_' + 'b'.repeat(64),
    })

    const frames: SessionFollowFrame[] = []
    for await (const frame of controller.follow({ address: { kind: 'session', sessionId: remoteId } })) {
      frames.push(frame)
    }
    expect(frames[0]?.type).toBe('snapshot')
    if (frames[0]?.type === 'snapshot') expect(frames[0].header.id).toBe(remoteId)

    await controller.prompt({ requestId: 'r' as SessionPromptRequest['requestId'], sessionId: remoteId, mode: 'queue', content: [{ type: 'text', text: 'hi' }] })
    expect(requests).toContain('prompt')

    dispose()
    const restored = await controller.list({})
    expect(restored.items).toHaveLength(1)
  })

  it('merges peer control projection into the local baseline', async () => {
    const peer: PeerInfo = {
      nodeId: 'nd_b',
      name: 'node-b',
      encKey: 'enc',
      signKey: 'sign',
      online: true,
      lastSeen: 0,
    }
    const link = {
      async *stream(op: string, _args: unknown, signal?: AbortSignal): AsyncIterable<unknown> {
        if (op !== 'session.control') return
        yield {
          type: 'baseline',
          value: { projections: { remote: { asOfSeq: 0, values: { running: true } } } },
        } satisfies SessionControlFrame
        yield {
          type: 'projection',
          sessionId: 'remote',
          seq: 1,
          changes: [{ key: 'running', val: false }],
        } satisfies SessionControlFrame
        await new Promise<void>((resolve) => {
          if (signal?.aborted === true) resolve()
          else signal?.addEventListener('abort', () => resolve(), { once: true })
        })
      },
    }
    const pool = {
      directory: () => [peer],
      link: () => link,
      sessions: async () => [],
    } as unknown as PeerPool

    const controller = new FakeController()
    const dispose = installFederation(controller, pool)
    const frames: SessionControlFrame[] = []
    for await (const frame of controller.control(new AbortController().signal)) {
      frames.push(frame)
      if (frames.some((item) => item.type === 'projection' && item.sessionId === 'remote')) break
    }
    const baseline = frames[0]
    if (baseline?.type !== 'baseline') throw new Error('missing baseline')
    expect(Object.keys(baseline.value.projections).sort()).toEqual(['local', 'remote'])
    expect(frames.some((item) => item.type === 'projection' && item.sessionId === 'remote')).toBe(true)
    dispose()
  })
})
