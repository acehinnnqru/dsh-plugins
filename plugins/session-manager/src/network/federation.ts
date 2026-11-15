/**
 * Host-side federation: make remote Sessions look like ordinary Session
 * Controller rows so the native client opens them through the normal path.
 *
 * A remote Session is never opened in this host's store. Every call for its id
 * is routed to the peer link that advertised it; the peer's host remains the
 * only writer.
 *
 * Remote rows are maintained by one `session.roster` stream per online peer:
 * an initial snapshot plus live changes. The wrapper re-emits those changes as
 * Host Session events, so the browser list follows without asking any node for
 * a full listing — a listing reads one header per stored Session.
 * @module dsh-plugin-session-manager/network/federation
 */

import type {
  SessionAddress,
  SessionControlBaseline,
  SessionControlFrame,
  SessionListRequest,
  SessionListValue,
  SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PeerInfo } from './protocol.ts'
import type { PeerPool } from './peer-client.ts'
import { isRosterFrame, type RosterFrame } from './roster.ts'

/** Structural controller methods the federation wraps. */
type Method = (this: Controller, ...args: any[]) => any
type Controller = Record<string, Method>

/** Host events one roster change turns into, so the browser list needs no listing. */
export interface FederationEvents {
  /** Whether this identity belongs to this host; a local row always wins over a peer copy. */
  isLocal(sessionId: string): boolean
  added(summary: SessionSummary): void
  removed(sessionId: string): void
  status(sessionId: string, running: boolean): void
  activity(sessionId: string, updatedAt: number): void
}

/** Pre-federation methods per controller, so peer serving stays local. */
const localMethodsByController = new WeakMap<object, Record<string, (...args: any[]) => any>>()

/** Read the pre-federation methods for one controller, if installed. */
export function localMethods(controller: object): Record<string, (...args: any[]) => any> | undefined {
  return localMethodsByController.get(controller)
}

/** One remote row and the peer that owns it. */
interface RemoteRow {
  readonly peer: PeerInfo
  /** Summary as the browser sees it: titled with the peer name and carrying its node projection. */
  readonly summary: SessionSummary
}

/** One live roster generation for one peer. */
interface Roster {
  readonly abort: AbortController
  /** Session ids this generation currently owns. */
  rows: Set<string>
  /** Resolves after the first snapshot, so a listing can wait for remote rows. */
  readonly ready: Promise<void>
  readonly settle: () => void
}

/** How long a listing waits for the first snapshot of each online peer. */
const ROSTER_READY_TIMEOUT_MS = 1_500

/** Reopen delay after a roster stream ends without this host closing it. */
const ROSTER_RETRY_MS = 5_000

/** Silence after which a roster stream counts as stalled and is replaced. */
const ROSTER_STALL_MS = 45_000

/** Resolve later; used for a roster's first snapshot. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/** Wait for a delay without holding the process open. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

/** Pull queue used to merge the local control stream with peer control streams. */
class ControlQueue implements AsyncIterable<SessionControlFrame> {
  private readonly values: SessionControlFrame[] = []
  private readonly waiters: (() => void)[] = []
  private done = false
  private error: Error | undefined

  push(value: SessionControlFrame): void {
    this.values.push(value)
    this.wake()
  }

  end(): void {
    this.done = true
    this.wake()
  }

  fail(error: Error): void {
    this.error = error
    this.done = true
    this.wake()
  }

  async next(): Promise<IteratorResult<SessionControlFrame>> {
    for (;;) {
      if (this.values.length > 0) return { done: false, value: this.values.shift() as SessionControlFrame }
      if (this.error !== undefined) throw this.error
      if (this.done) return { done: true, value: undefined }
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SessionControlFrame> {
    return this
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter()
  }
}

/** Read one iterator result, or undefined when the peer does not open in time. */
async function firstWithin(
  iterator: AsyncIterator<SessionControlFrame>,
  timeoutMs: number,
): Promise<IteratorResult<SessionControlFrame> | undefined> {
  return await Promise.race([
    iterator.next(),
    new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), timeoutMs)
    }),
  ])
}

/** Install the federation wrapper over one Session Controller. */
export function installFederation(controller: object, pool: PeerPool, events: FederationEvents): () => void {
  const proto = Object.getPrototypeOf(controller) as Controller | null
  if (proto === null) return () => {}
  const originalList = proto['list']
  const originalFollow = proto['follow']
  if (typeof originalList !== 'function' || typeof originalFollow !== 'function') return () => {}

  const restores: (() => void)[] = []
  const remote = new Map<string, RemoteRow>()
  const rosters = new Map<string, Roster>()
  const locals: Record<string, (...args: any[]) => any> = {
    list: (...args: any[]) => originalList.call(controller as Controller, ...args),
    follow: (...args: any[]) => originalFollow.call(controller as Controller, ...args),
  }
  let disposed = false

  const remember = (name: string): Method | undefined => {
    const value = proto[name]
    if (typeof value !== 'function') return undefined
    locals[name] ??= (...args: any[]) => value.call(controller as Controller, ...args)
    return value
  }
  const replace = (name: string, wrapper: Method): void => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name)
    if (descriptor === undefined || typeof descriptor.value !== 'function') return
    Object.defineProperty(proto, name, { ...descriptor, value: wrapper })
    restores.push(() => Object.defineProperty(proto, name, descriptor))
  }

  /** Let the first directory arrive before a page load decides the peer set. */
  const waitDirectory = async (): Promise<void> => {
    const ready = (pool as { readonly ready?: Promise<void> }).ready
    if (ready === undefined) return
    await Promise.race([
      ready,
      new Promise<void>((resolve) => {
        setTimeout(resolve, 800)
      }),
    ])
  }

  const titled = (summary: SessionSummary, peer: PeerInfo): SessionSummary => {
    const base = summary.projections ?? { kind: 'cached' as const, asOfSeq: 0, values: {} }
    const values = base.values as Readonly<Record<string, unknown>>
    const current = typeof values['title'] === 'string' ? values['title'] : 'session'
    const projections = {
      ...base,
      values: {
        ...values,
        title: '[' + peer.name + '] ' + current,
        sessionManagerNode: {
          nodeId: peer.nodeId,
          name: peer.name,
          ...(peer.instanceId === undefined ? {} : { instanceId: peer.instanceId }),
        },
      },
    } as NonNullable<SessionSummary['projections']>
    return { ...summary, projections }
  }

  /** Apply one roster frame and relay it as a Host Session event. */
  const applyRoster = (peer: PeerInfo, roster: Roster, frame: RosterFrame): void => {
    switch (frame.type) {
      case 'roster/snapshot': {
        const next = new Set<string>()
        for (const item of frame.items) {
          if (events.isLocal(item.sessionId)) continue
          const owner = remote.get(item.sessionId)
          if (owner !== undefined && owner.peer.nodeId !== peer.nodeId) continue
          next.add(item.sessionId)
          remote.set(item.sessionId, { peer, summary: titled(item, peer) })
        }
        for (const sessionId of roster.rows) {
          if (next.has(sessionId)) continue
          const owner = remote.get(sessionId)
          if (owner === undefined || owner.peer.nodeId !== peer.nodeId) continue
          remote.delete(sessionId)
          events.removed(sessionId)
        }
        roster.rows = next
        for (const sessionId of next) {
          const row = remote.get(sessionId)
          if (row !== undefined) events.added(row.summary)
        }
        return
      }
      case 'roster/added': {
        if (events.isLocal(frame.summary.sessionId)) return
        const owner = remote.get(frame.summary.sessionId)
        if (owner !== undefined && owner.peer.nodeId !== peer.nodeId) return
        const summary = titled(frame.summary, peer)
        remote.set(frame.summary.sessionId, { peer, summary })
        roster.rows.add(frame.summary.sessionId)
        events.added(summary)
        return
      }
      case 'roster/removed': {
        if (remote.get(frame.sessionId)?.peer.nodeId !== peer.nodeId) return
        remote.delete(frame.sessionId)
        roster.rows.delete(frame.sessionId)
        events.removed(frame.sessionId)
        return
      }
      case 'roster/status': {
        const row = remote.get(frame.sessionId)
        if (row === undefined || row.peer.nodeId !== peer.nodeId) return
        remote.set(frame.sessionId, { peer, summary: { ...row.summary, running: frame.running } })
        events.status(frame.sessionId, frame.running)
        return
      }
      case 'roster/activity': {
        const row = remote.get(frame.sessionId)
        if (row === undefined || row.peer.nodeId !== peer.nodeId) return
        remote.set(frame.sessionId, { peer, summary: { ...row.summary, updatedAt: frame.updatedAt } })
        events.activity(frame.sessionId, frame.updatedAt)
        return
      }
      default:
        // Heartbeat: liveness only.
        return
    }
  }

  /** Consume one roster generation; reopen it after a stall or a peer restart. */
  const runRoster = async (peer: PeerInfo, roster: Roster): Promise<void> => {
    const link = pool.link(peer.nodeId)
    if (link === undefined) return
    let stalled = false
    let watchdog: NodeJS.Timeout | undefined
    const arm = (): void => {
      if (watchdog !== undefined) clearTimeout(watchdog)
      watchdog = setTimeout(() => {
        stalled = true
        roster.abort.abort()
      }, ROSTER_STALL_MS)
      watchdog.unref?.()
    }
    arm()
    try {
      for await (const frame of link.stream('session.roster', {}, roster.abort.signal)) {
        arm()
        if (!isRosterFrame(frame)) continue
        applyRoster(peer, roster, frame)
        if (frame.type === 'roster/snapshot') roster.settle()
      }
    } catch {
      // A closed link, a peer restart, or a peer without the operation.
    } finally {
      if (watchdog !== undefined) clearTimeout(watchdog)
    }
    // A close of this generation, a replacement, or teardown owns the rows.
    if (disposed || rosters.get(peer.nodeId) !== roster) return
    if (roster.abort.signal.aborted && !stalled) return
    await sleep(ROSTER_RETRY_MS)
    if (disposed || rosters.get(peer.nodeId) !== roster) return
    if (pool.link(peer.nodeId) === undefined) return
    openRoster(peer, roster.rows)
  }

  /** Open one roster generation, keeping the rows it replaces for a snapshot diff. */
  const openRoster = (peer: PeerInfo, rows: Set<string> = new Set()): void => {
    const settled = deferred()
    const roster: Roster = {
      abort: new AbortController(),
      rows,
      ready: settled.promise,
      settle: settled.resolve,
    }
    rosters.set(peer.nodeId, roster)
    void runRoster(peer, roster)
  }

  /** Drop one peer's roster and every row it owns. */
  const closeRoster = (nodeId: string): void => {
    const roster = rosters.get(nodeId)
    if (roster === undefined) return
    rosters.delete(nodeId)
    roster.abort.abort()
    for (const sessionId of roster.rows) {
      if (remote.get(sessionId)?.peer.nodeId !== nodeId) continue
      remote.delete(sessionId)
      if (!disposed) events.removed(sessionId)
    }
    roster.rows.clear()
  }

  /** Match open rosters to the online peer set. */
  const syncPeers = (): void => {
    if (disposed) return
    const online = new Map<string, PeerInfo>()
    for (const peer of pool.directory()) {
      if (!peer.online || pool.link(peer.nodeId) === undefined) continue
      online.set(peer.nodeId, peer)
    }
    for (const nodeId of rosters.keys()) {
      if (!online.has(nodeId)) closeRoster(nodeId)
    }
    for (const peer of online.values()) {
      if (!rosters.has(peer.nodeId)) openRoster(peer)
    }
  }

  /** Wait for the first snapshot of every open roster, bounded. */
  const waitRosters = async (): Promise<void> => {
    const pending = [...rosters.values()].map((roster) => roster.ready)
    if (pending.length === 0) return
    await Promise.race([
      Promise.all(pending),
      new Promise<void>((resolve) => {
        setTimeout(resolve, ROSTER_READY_TIMEOUT_MS)
      }),
    ])
  }

  const unsubscribe = pool.onChange(syncPeers)
  syncPeers()

  const list = async function (this: Controller, request: SessionListRequest, signal: AbortSignal): Promise<SessionListValue> {
    const value = await originalList.call(this, request, signal) as SessionListValue
    if (request.cursor !== undefined) return value
    syncPeers()
    await waitRosters()
    const seen = new Set<string>(value.items.map((item) => item.sessionId))
    const items = [...value.items]
    for (const [sessionId, row] of remote) {
      if (seen.has(sessionId)) continue
      items.push(row.summary)
    }
    return { items }
  }

  const remoteRow = (sessionId: SessionId): RemoteRow | undefined => remote.get(sessionId)

  const follow = async function* (this: Controller, request: { address: SessionAddress; maxMessages?: number; activate?: boolean; assistantStream?: true }, signal: AbortSignal): AsyncIterable<unknown> {
    if (request.address.kind !== 'session') {
      yield* originalFollow.call(this, request, signal) as AsyncIterable<unknown>
      return
    }
    const row = remoteRow(request.address.sessionId)
    if (row === undefined) {
      yield* originalFollow.call(this, request, signal) as AsyncIterable<unknown>
      return
    }
    const link = pool.link(row.peer.nodeId)
    if (link === undefined) throw new Error('peer link unavailable')
    yield* link.stream('session.follow', {
      sessionId: request.address.sessionId,
      ...(request.maxMessages === undefined ? {} : { maxMessages: request.maxMessages }),
      ...(request.activate === true ? { activate: true } : {}),
      ...(request.assistantStream === true ? { assistantStream: true } : {}),
    })
  }

  const wrapSessionUnary = (name: string, withSignal: boolean): void => {
    const original = remember(name)
    if (original === undefined) return
    if (withSignal) {
      replace(name, async function (this: Controller, request: { sessionId: SessionId }, signal: AbortSignal) {
        const row = remoteRow(request.sessionId)
        const link = row === undefined ? undefined : pool.link(row.peer.nodeId)
        if (row === undefined || link === undefined) return original.call(this, request, signal)
        return link.request('session.' + name, { ...request })
      })
      return
    }
    replace(name, async function (this: Controller, request: { sessionId: SessionId }) {
      const row = remoteRow(request.sessionId)
      const link = row === undefined ? undefined : pool.link(row.peer.nodeId)
      if (row === undefined || link === undefined) return original.call(this, request)
      return link.request('session.' + name, { ...request })
    })
  }

  const wrapSessionStream = (name: string): void => {
    const original = remember(name)
    if (original === undefined) return
    replace(name, async function* (this: Controller, request: { sessionId: SessionId }, signal: AbortSignal) {
      const row = remoteRow(request.sessionId)
      const link = row === undefined ? undefined : pool.link(row.peer.nodeId)
      if (row === undefined || link === undefined) {
        yield* original.call(this, request, signal) as AsyncIterable<unknown>
        return
      }
      yield* link.stream('session.' + name, { ...request })
    })
  }

  const wrapAddressUnary = (name: string): void => {
    const original = remember(name)
    if (original === undefined) return
    replace(name, async function (this: Controller, request: { address: SessionAddress }, signal: AbortSignal) {
      if (request.address.kind !== 'session') return original.call(this, request, signal)
      const row = remoteRow(request.address.sessionId)
      const link = row === undefined ? undefined : pool.link(row.peer.nodeId)
      if (row === undefined || link === undefined) return original.call(this, request, signal)
      return link.request('session.' + name, { sessionId: request.address.sessionId, ...request })
    })
  }

  const wrapAddressStream = (name: string): void => {
    const original = remember(name)
    if (original === undefined) return
    replace(name, async function* (this: Controller, request: { address: SessionAddress }, signal: AbortSignal) {
      if (request.address.kind !== 'session') {
        yield* original.call(this, request, signal) as AsyncIterable<unknown>
        return
      }
      const row = remoteRow(request.address.sessionId)
      const link = row === undefined ? undefined : pool.link(row.peer.nodeId)
      if (row === undefined || link === undefined) {
        yield* original.call(this, request, signal) as AsyncIterable<unknown>
        return
      }
      yield* link.stream('session.' + name, { sessionId: request.address.sessionId, ...request })
    })
  }

  const wrapControl = (): void => {
    const original = remember('control')
    if (original === undefined) return
    replace('control', async function* (this: Controller, signal: AbortSignal): AsyncIterable<SessionControlFrame> {
      await waitDirectory()
      const peers = pool.directory().filter((peer) => peer.online)
      const remote: { readonly iterator: AsyncIterator<SessionControlFrame>; readonly abort: AbortController }[] = []
      for (const peer of peers) {
        const link = pool.link(peer.nodeId)
        if (link === undefined) continue
        const abort = new AbortController()
        const iterator = (link.stream('session.control', {}, abort.signal) as AsyncIterable<SessionControlFrame>)[Symbol.asyncIterator]()
        remote.push({ iterator, abort })
      }
      const local = (original.call(this, signal) as AsyncIterable<SessionControlFrame>)[Symbol.asyncIterator]()
      const first = await local.next()
      if (first.done) return
      if (first.value.type !== 'baseline') {
        yield first.value
        for (;;) {
          const next = await local.next()
          if (next.done) return
          yield next.value
        }
      }

      const projections: Record<string, unknown> = { ...first.value.value.projections }
      const active: { readonly iterator: AsyncIterator<SessionControlFrame>; readonly abort: AbortController }[] = []
      for (const peer of remote) {
        try {
          const frame = await firstWithin(peer.iterator, 1_500)
          if (frame === undefined || frame.done || frame.value.type !== 'baseline') {
            peer.abort.abort()
            continue
          }
          Object.assign(projections, frame.value.value.projections)
          active.push(peer)
        } catch {
          peer.abort.abort()
        }
      }

      const queue = new ControlQueue()
      const fail = (error: unknown): void => {
        queue.fail(error instanceof Error ? error : new Error(String(error)))
      }
      yield { type: 'baseline', value: { projections } as SessionControlBaseline }

      const pump = async (iterator: AsyncIterator<SessionControlFrame>, peer: boolean): Promise<void> => {
        try {
          for (;;) {
            const next = await iterator.next()
            if (next.done) {
              if (!peer) queue.end()
              return
            }
            queue.push(next.value)
          }
        } catch (error) {
          if (!peer) fail(error)
        }
      }
      void pump(local, false)
      for (const peer of active) void pump(peer.iterator, true)
      try {
        for await (const frame of queue) yield frame
      } finally {
        for (const peer of active) peer.abort.abort()
        void local.return?.(undefined)
      }
    })
  }

  replace('list', list)
  replace('follow', follow)
  wrapControl()
  wrapAddressUnary('events')
  wrapAddressUnary('page')
  wrapAddressStream('observeEvent')
  for (const name of ['state', 'projections', 'prompt', 'wait', 'openWorkspacePath'] as const) wrapSessionUnary(name, true)
  for (const name of ['cancel', 'rename', 'updateQueue', 'attachment', 'selectModel'] as const) wrapSessionUnary(name, false)
  for (const name of ['observeState', 'observeProjections'] as const) wrapSessionStream(name)
  localMethodsByController.set(controller, locals)

  return () => {
    disposed = true
    unsubscribe()
    for (const nodeId of rosters.keys()) closeRoster(nodeId)
    localMethodsByController.delete(controller)
    for (const restore of restores.reverse()) restore()
    remote.clear()
  }
}
