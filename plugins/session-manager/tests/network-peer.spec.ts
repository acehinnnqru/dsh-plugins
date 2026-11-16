import { describe, expect, it } from 'vitest'
import type { SessionFollowFrame, SessionFollowRequest, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BridgeFrame, PeerInfo } from '../src/network/protocol.ts'
import { PeerPool } from '../src/network/peer-client.ts'
import { createPeerResponder, type PeerResponder } from '../src/network/peer-responder.ts'
import { rosterStream, type RosterFrame } from '../src/network/roster.ts'

/** One minimal summary. */
function summary(sessionId: SessionId): SessionSummary {
  return {
    agentAvailable: true,
    sessionId,
    updatedAt: 1,
    running: false,
    blank: false,
    cwd: 'source',
    projections: { kind: 'sequenced', asOfSeq: 0, values: {} },
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

/** One directory row. */
function peer(nodeId: string, name: string): PeerInfo {
  return { nodeId, name, encKey: 'enc', signKey: 'sign', online: true, lastSeen: 0 }
}

describe('bridged peer session RPC', () => {
  it('serves list, follow, and prompt through the server transport', async () => {
    const prompted: string[] = []
    const controller = {
      async list(): Promise<{ items: SessionSummary[] }> {
        return { items: [summary('01S' as SessionId)] }
      },
      async *follow(request: SessionFollowRequest): AsyncIterable<SessionFollowFrame> {
        const id = request.address.kind === 'session' ? request.address.sessionId : ('01S' as SessionId)
        yield snapshot(id)
      },
      async prompt(request: { sessionId: SessionId }): Promise<{ accepted: true }> {
        prompted.push(request.sessionId)
        return { accepted: true }
      },
      async create(request: { cwd: string }): Promise<{ sessionId: SessionId }> {
        return { sessionId: request.cwd as SessionId }
      },
    }

    let poolA: PeerPool
    let responderB: PeerResponder
    const transportB = {
      send(frame: BridgeFrame): void {
        poolA.handle({ ...frame, from: 'nd_b' } as never)
      },
    }
    responderB = createPeerResponder({
      controller,
      logger: () => {},
      sender: (frame) => transportB.send(frame),
      roster: (signal) => rosterStream({
        list: () => controller.list(),
        subscribe: () => () => {},
      }, signal),
    })
    const responderA = createPeerResponder({
      controller: { async list() { return { items: [] } } },
      logger: () => {},
      sender: () => {},
    })
    const transportA = {
      send(frame: BridgeFrame): void {
        if (frame.type === 'bridge.request') {
          responderB.handle({ ...frame, from: 'nd_a' })
          return
        }
        if (frame.type === 'bridge.cancel') responderB.cancel(frame.id)
      },
    }
    poolA = new PeerPool('nd_a', transportA)
    const poolB = new PeerPool('nd_b', transportB)
    poolA.update([peer('nd_b', 'b')])
    poolB.update([peer('nd_a', 'a')])

    const rows = await poolA.sessions('nd_b')
    expect(rows).toHaveLength(1)
    expect((rows[0] as SessionSummary).sessionId).toBe('01S')

    const frames: SessionFollowFrame[] = []
    const link = poolA.link('nd_b')
    expect(link).toBeDefined()
    for await (const frame of link?.stream('session.follow', { sessionId: '01S' }) ?? []) {
      frames.push(frame as SessionFollowFrame)
    }
    expect(frames[0]?.type).toBe('snapshot')

    await link?.request('session.prompt', {
      sessionId: '01S',
      requestId: 'request',
      mode: 'queue',
      content: [{ type: 'text', text: 'hello' }],
    })
    expect(prompted).toEqual(['01S'])

    const created = await link?.request('session.create', { cwd: '/work/new' })
    expect((created as { sessionId?: string } | undefined)?.sessionId).toBe('/work/new')

    const rosterFrames: RosterFrame[] = []
    for await (const frame of link?.stream('session.roster', {}) ?? []) {
      rosterFrames.push(frame as RosterFrame)
      if (rosterFrames.length === 1) break
    }
    expect(rosterFrames[0]).toMatchObject({ type: 'roster/snapshot' })
    if (rosterFrames[0]?.type === 'roster/snapshot') {
      expect(rosterFrames[0].items.map((item) => item.sessionId)).toEqual(['01S'])
    }

    responderA.close()
    responderB.close()
    poolA.close()
    poolB.close()
  })

  it('dispatches an Agent-scoped endpoint on the owning node', async () => {
    let poolA: PeerPool
    const invoked: string[] = []
    const responderB = createPeerResponder({
      controller: {},
      logger: () => {},
      sender: (frame) => poolA.handle({ ...frame, from: 'nd_b' } as never),
      invokeAgent: async (namespace, method, args) => {
        invoked.push(namespace + '/' + method + ':' + String(args['agentId']))
        return [{ path: 'src/index.ts' }]
      },
    })
    poolA = new PeerPool('nd_a', {
      send(frame: BridgeFrame): void {
        if (frame.type === 'bridge.request') responderB.handle({ ...frame, from: 'nd_a' })
        if (frame.type === 'bridge.cancel') responderB.cancel(frame.id)
      },
    })
    poolA.update([peer('nd_b', 'b')])

    const value = await poolA.link('nd_b')?.request('agent.invoke', {
      endpoint: 'fileReferences/list',
      args: { agentId: '01S', query: 'src' },
    })
    expect(value).toEqual([{ path: 'src/index.ts' }])
    expect(invoked).toEqual(['fileReferences/list:01S'])

    responderB.close()
    poolA.close()
  })

  it('refuses an answer too large to carry in one bridge frame', async () => {
    let poolA: PeerPool
    const responderB = createPeerResponder({
      controller: {},
      logger: () => {},
      sender: (frame) => poolA.handle({ ...frame, from: 'nd_b' } as never),
      // Comfortably past the 4 M character bridge limit.
      invokeAgent: async () => 'x'.repeat(4 * 1024 * 1024 + 1),
    })
    poolA = new PeerPool('nd_a', {
      send(frame: BridgeFrame): void {
        if (frame.type === 'bridge.request') responderB.handle({ ...frame, from: 'nd_a' })
      },
    })
    poolA.update([peer('nd_b', 'b')])

    const read = { endpoint: 'workspaceFiles/read', args: { agentId: '01S' } }
    await expect(poolA.link('nd_b')?.request('agent.invoke', read)).rejects.toThrow(/over the bridge limit/)

    responderB.close()
    poolA.close()
  })

  it('refuses an Agent-scoped endpoint when the owner dispatches none', async () => {
    let poolA: PeerPool
    const responderB = createPeerResponder({
      controller: {},
      logger: () => {},
      sender: (frame) => poolA.handle({ ...frame, from: 'nd_b' } as never),
    })
    poolA = new PeerPool('nd_a', {
      send(frame: BridgeFrame): void {
        if (frame.type === 'bridge.request') responderB.handle({ ...frame, from: 'nd_a' })
      },
    })
    poolA.update([peer('nd_b', 'b')])

    await expect(
      poolA.link('nd_b')?.request('agent.invoke', { endpoint: 'commands/list', args: { agentId: '01S' } }),
    ).rejects.toThrow('peer/unsupported')

    responderB.close()
    poolA.close()
  })
})