/**
 * Host-side federation: make remote Sessions look like ordinary Session
 * Controller rows so the native client opens them through the normal path.
 *
 * A remote Session is never opened in this host's store. Every call for its id
 * is routed to the peer link that advertised it; the peer's host remains the
 * only writer.
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

/** Structural controller methods the federation wraps. */
type Method = (this: Controller, ...args: any[]) => any
type Controller = Record<string, Method>

/** Pre-federation methods per controller, so peer serving stays local. */
const localMethodsByController = new WeakMap<object, Record<string, (...args: any[]) => any>>()

/** Read the pre-federation methods for one controller, if installed. */
export function localMethods(controller: object): Record<string, (...args: any[]) => any> | undefined {
  return localMethodsByController.get(controller)
}

/** One remote row and the peer that owns it. */
interface RemoteRow {
  readonly peer: PeerInfo
  readonly summary: SessionSummary
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
export function installFederation(controller: object, pool: PeerPool): () => void {
  const proto = Object.getPrototypeOf(controller) as Controller | null
  if (proto === null) return () => {}
  const originalList = proto['list']
  const originalFollow = proto['follow']
  if (typeof originalList !== 'function' || typeof originalFollow !== 'function') return () => {}

  const restores: (() => void)[] = []
  const remote = new Map<string, RemoteRow>()
  const locals: Record<string, (...args: any[]) => any> = {
    list: (...args: any[]) => originalList.call(controller as Controller, ...args),
    follow: (...args: any[]) => originalFollow.call(controller as Controller, ...args),
  }

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
        sessionManagerNode: { nodeId: peer.nodeId, name: peer.name },
      },
    } as NonNullable<SessionSummary['projections']>
    return { ...summary, projections }
  }

  const refresh = async (self: SessionListValue): Promise<SessionListValue> => {
    await waitDirectory()
    remote.clear()
    const items = [...self.items]
    const peers = pool.directory().filter((peer) => peer.online)
    await Promise.all(peers.map(async (peer) => {
      try {
        const rows = await Promise.race([
          pool.sessions(peer.nodeId),
          new Promise<readonly unknown[]>((resolve) => setTimeout(() => resolve([]), 1500)),
        ])
        for (const value of rows) {
          const summary = value as SessionSummary
          if (items.some((item) => item.sessionId === summary.sessionId)) continue
          remote.set(summary.sessionId, { peer, summary })
          items.push(titled(summary, peer))
        }
      } catch {
        // A peer that cannot answer simply contributes no rows.
      }
    }))
    return { items }
  }

  const list = async function (this: Controller, request: SessionListRequest, signal: AbortSignal): Promise<SessionListValue> {
    const value = await originalList.call(this, request, signal) as SessionListValue
    if (request.cursor !== undefined) return value
    return refresh(value)
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
        return link.request(name, { ...request })
      })
      return
    }
    replace(name, async function (this: Controller, request: { sessionId: SessionId }) {
      const row = remoteRow(request.sessionId)
      const link = row === undefined ? undefined : pool.link(row.peer.nodeId)
      if (row === undefined || link === undefined) return original.call(this, request)
      return link.request(name, { ...request })
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
      yield* link.stream(name, { ...request })
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
      return link.request(name, { sessionId: request.address.sessionId, ...request })
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
      yield* link.stream(name, { sessionId: request.address.sessionId, ...request })
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
          const frame = await firstWithin(peer.iterator, 1500)
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
    localMethodsByController.delete(controller)
    for (const restore of restores.reverse()) restore()
    remote.clear()
  }
}
