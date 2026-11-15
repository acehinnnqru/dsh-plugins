import { afterEach, describe, expect, it } from 'vitest'
import type { SessionControlFrame, SessionFollowFrame, SessionFollowRequest, SessionListRequest, SessionListValue, SessionPromptRequest, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { installFederation, type FederationEvents } from '../src/network/federation.ts'
import type { PeerPool } from '../src/network/peer-client.ts'
import type { PeerInfo } from '../src/network/protocol.ts'
import type { RosterFrame } from '../src/network/roster.ts'

/** One summary row. */
function summary(sessionId: string, title: string): SessionSummary {
  return {
    agentAvailable: true,
    sessionId: sessionId as SessionId,
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

/** One directory row. */
function peer(nodeId: string, name: string): PeerInfo {
  return { nodeId, name, encKey: 'enc', signKey: 'sign', online: true, lastSeen: 0 }
}

/** Recorded Host events. */
interface Recorded {
  readonly added: SessionSummary[]
  readonly removed: string[]
  readonly status: [string, boolean][]
  readonly activity: [string, number][]
}

/** One event sink over a recorder. */
function sink(recorded: Recorded, local: (sessionId: string) => boolean = (id) => id === 'local'): FederationEvents {
  return {
    isLocal: local,
    added: (summary) => recorded.added.push(summary),
    removed: (sessionId) => recorded.removed.push(sessionId),
    status: (sessionId, running) => recorded.status.push([sessionId, running]),
    activity: (sessionId, updatedAt) => recorded.activity.push([sessionId, updatedAt]),
  }
}

/** One recorder. */
function recorder(): Recorded {
  return { added: [], removed: [], status: [], activity: [] }
}

/** A bridge link whose roster stream is driven by the test. */
class FakeLink {
  readonly requests: string[] = []
  private readonly queue: RosterFrame[] = []
  private wake: (() => void) | undefined
  private aborted = false

  async request(op: string): Promise<unknown> {
    this.requests.push(op)
    return { accepted: true }
  }

  push(frame: RosterFrame): void {
    this.queue.push(frame)
    this.wake?.()
    this.wake = undefined
  }

  async *stream(op: string, args: unknown, signal?: AbortSignal): AsyncIterable<unknown> {
    if (op === 'session.follow') {
      yield snapshot((args as { readonly sessionId: SessionId }).sessionId)
      return
    }
    if (op !== 'session.roster') return
    signal?.addEventListener('abort', () => {
      this.aborted = true
      this.wake?.()
      this.wake = undefined
    }, { once: true })
    for (;;) {
      const frame = this.queue.shift()
      if (frame !== undefined) {
        yield frame
        continue
      }
      if (this.aborted || signal?.aborted === true) return
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
    }
  }
}

/** A pool over a fixed directory and one shared link. */
class FakePool {
  private peers: PeerInfo[] = []
  private readonly listeners = new Set<() => void>()

  constructor(private readonly bridge: FakeLink | undefined) {}

  setPeers(peers: readonly PeerInfo[]): void {
    this.peers = [...peers]
    for (const listener of this.listeners) listener()
  }

  directory(): readonly PeerInfo[] {
    return this.peers
  }

  link(nodeId: string): FakeLink | undefined {
    return this.peers.some((item) => item.nodeId === nodeId && item.online) ? this.bridge : undefined
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

/** Fake local controller. */
class FakeController {
  async list(_request: SessionListRequest): Promise<SessionListValue> {
    return { items: [summary('local', 'local')] }
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

/** Let roster frames reach the row map. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Disposers for the installs one test made; failure must not leak the wrapper. */
const disposers: (() => void)[] = []

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

/** Install one federation and clean it up after the test. */
function install(controller: object, pool: PeerPool, events: FederationEvents): () => void {
  const dispose = installFederation(controller, pool, events)
  disposers.push(dispose)
  return dispose
}

/** One titled row from a merged listing. */
function valuesOf(value: SessionSummary | undefined): Readonly<Record<string, unknown>> | undefined {
  return value?.projections?.values as Readonly<Record<string, unknown>> | undefined
}

describe('host session federation', () => {
  it('merges roster rows and routes remote calls to the peer link', async () => {
    const recorded = recorder()
    const link = new FakeLink()
    const pool = new FakePool(link)
    pool.setPeers([peer('nd_b', 'node-b')])
    const controller = new FakeController()
    const dispose = install(controller, pool as unknown as PeerPool, sink(recorded))

    link.push({ type: 'roster/snapshot', items: [summary('remote', 'remote')] })
    link.push({ type: 'roster/added', summary: summary('second', 'second') })
    link.push({ type: 'roster/status', sessionId: 'second', running: true })
    link.push({ type: 'roster/activity', sessionId: 'second', updatedAt: 42 })
    await settle()

    expect(recorded.added.map((item) => item.sessionId)).toEqual(['remote', 'second'])
    expect(recorded.status).toEqual([['second', true]])
    expect(recorded.activity).toEqual([['second', 42]])
    expect(valuesOf(recorded.added[0])?.['title']).toBe('[node-b] remote')
    expect(valuesOf(recorded.added[0])?.['sessionManagerNode']).toEqual({ nodeId: 'nd_b', name: 'node-b' })

    const listed = await controller.list({})
    expect(listed.items.map((item) => item.sessionId)).toEqual(['local', 'remote', 'second'])
    const second = listed.items.find((item) => item.sessionId === 'second')
    expect(second?.running).toBe(true)
    expect(second?.updatedAt).toBe(42)
    expect(valuesOf(second)?.['title']).toBe('[node-b] second')

    const frames: SessionFollowFrame[] = []
    for await (const frame of controller.follow({ address: { kind: 'session', sessionId: 'remote' as SessionId } })) {
      frames.push(frame)
    }
    expect(frames[0]?.type).toBe('snapshot')
    if (frames[0]?.type === 'snapshot') expect(frames[0].header.id).toBe('remote')

    await controller.prompt({ requestId: 'r' as SessionPromptRequest['requestId'], sessionId: 'remote' as SessionId, mode: 'queue', content: [{ type: 'text', text: 'hi' }] })
    expect(link.requests).toContain('session.prompt')

    dispose()
    const restored = await controller.list({})
    expect(restored.items).toHaveLength(1)
  })

  it('relays roster removal and drops rows when the peer goes offline', async () => {
    const recorded = recorder()
    const link = new FakeLink()
    const pool = new FakePool(link)
    pool.setPeers([peer('nd_b', 'node-b')])
    const controller = new FakeController()
    const dispose = install(controller, pool as unknown as PeerPool, sink(recorded))

    link.push({ type: 'roster/snapshot', items: [summary('r1', 'r1'), summary('r2', 'r2')] })
    await settle()
    expect(recorded.added).toHaveLength(2)

    link.push({ type: 'roster/removed', sessionId: 'r1' })
    await settle()
    expect(recorded.removed).toEqual(['r1'])
    expect((await controller.list({})).items.map((item) => item.sessionId)).toEqual(['local', 'r2'])

    pool.setPeers([{ ...peer('nd_b', 'node-b'), online: false }])
    await settle()
    expect(recorded.removed).toEqual(['r1', 'r2'])
    expect((await controller.list({})).items).toHaveLength(1)

    dispose()
  })

  it('keeps a local row when a peer reports the same identity', async () => {
    const recorded = recorder()
    const link = new FakeLink()
    const pool = new FakePool(link)
    pool.setPeers([peer('nd_b', 'node-b')])
    const controller = new FakeController()
    const dispose = install(controller, pool as unknown as PeerPool, sink(recorded))

    link.push({ type: 'roster/snapshot', items: [summary('local', 'shadow'), summary('remote', 'remote')] })
    await settle()
    expect(recorded.added.map((item) => item.sessionId)).toEqual(['remote'])
    expect((await controller.list({})).items.map((item) => item.sessionId)).toEqual(['local', 'remote'])

    dispose()
  })

  it('merges peer control projection into the local baseline', async () => {
    const peerRow = peer('nd_b', 'node-b')
    const control: (op: string) => AsyncIterable<unknown> = async function* (op) {
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
    }
    const link = {
      async request() {
        return {}
      },
      stream: control,
    }
    let listeners = 0
    const pool = {
      directory: () => [peerRow],
      link: () => link,
      onChange: () => {
        listeners += 1
        return () => {
          listeners -= 1
        }
      },
    } as unknown as PeerPool

    const controller = new FakeController()
    const dispose = install(controller, pool, sink(recorder()))
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
    expect(listeners).toBe(0)
  })
})
