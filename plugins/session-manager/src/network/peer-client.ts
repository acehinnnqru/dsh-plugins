/**
 * Peer Session RPC over the server bridge. There is no peer socket: every
 * request is a frame on this node's server link, and the server routes it to
 * the owning node.
 * @module dsh-plugin-session-manager/network/peer-client
 */

import { randomUUID } from 'node:crypto'
import type {
  BridgeEndFrame,
  BridgeErrorFrame,
  BridgeFrame,
  BridgeResponseFrame,
  BridgeStreamFrame,
  PeerInfo,
} from './protocol.ts'

/** One outgoing bridge socket. */
export interface BridgeTransport {
  send(frame: BridgeFrame): void
}

/** A bridge answer routed back to this node. */
export type BridgeAnswer = BridgeResponseFrame | BridgeStreamFrame | BridgeEndFrame | BridgeErrorFrame

/** One peer's request space. */
export class PeerLink {
  private readonly nodeId: string
  private readonly peerId: string
  private readonly transport: BridgeTransport
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private readonly streams = new Map<string, FrameQueue>()
  private closed = false

  constructor(nodeId: string, peerId: string, transport: BridgeTransport) {
    this.nodeId = nodeId
    this.peerId = peerId
    this.transport = transport
  }

  /** One request/response. */
  async request(op: string, args: unknown): Promise<unknown> {
    if (this.closed) throw new Error('peer closed')
    const id = this.nodeId + ':' + randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.send({ type: 'bridge.cancel', v: 1, id, to: this.peerId })
        reject(new Error('peer request timeout'))
      }, 10_000)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      this.send({ type: 'bridge.request', v: 1, id, to: this.peerId, op, args })
    })
  }

  /** One streaming request. */
  async *stream(op: string, args: unknown, signal?: AbortSignal): AsyncIterable<unknown> {
    if (this.closed) throw new Error('peer closed')
    const id = this.nodeId + ':' + randomUUID()
    const queue = new FrameQueue()
    this.streams.set(id, queue)
    const cancel = (): void => {
      if (!this.streams.delete(id)) return
      queue.fail(new Error('peer stream aborted'))
      this.send({ type: 'bridge.cancel', v: 1, id, to: this.peerId })
    }
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted === true) {
      this.streams.delete(id)
      return
    }
    this.send({ type: 'bridge.request', v: 1, id, to: this.peerId, op, args })
    try {
      for (;;) {
        const next = await queue.next()
        if (next.done) return
        yield next.value
      }
    } finally {
      signal?.removeEventListener('abort', cancel)
      if (this.streams.delete(id)) this.send({ type: 'bridge.cancel', v: 1, id, to: this.peerId })
    }
  }

  /** Fail outstanding work and stop sending. */
  close(): void {
    this.closed = true
    for (const [id] of this.streams) this.send({ type: 'bridge.cancel', v: 1, id, to: this.peerId })
    this.failAll(new Error('peer closed'))
  }

  /** Route one answer that the server addressed to this node. */
  handle(frame: BridgeAnswer): void {
    if (frame.type === 'bridge.response') {
      const pending = this.pending.get(frame.id)
      if (pending === undefined) return
      this.pending.delete(frame.id)
      if (frame.ok) pending.resolve(frame.value)
      else pending.reject(new Error(frame.error?.code ?? 'peer/failed'))
      return
    }
    if (frame.type === 'bridge.stream') {
      this.streams.get(frame.id)?.push(frame.frame)
      return
    }
    if (frame.type === 'bridge.end') {
      const queue = this.streams.get(frame.id)
      if (queue !== undefined) {
        this.streams.delete(frame.id)
        queue.end()
      }
      return
    }
    const pending = this.pending.get(frame.id)
    if (pending !== undefined) {
      this.pending.delete(frame.id)
      pending.reject(new Error(frame.error.message))
      return
    }
    const queue = this.streams.get(frame.id)
    if (queue !== undefined) {
      this.streams.delete(frame.id)
      queue.fail(new Error(frame.error.message))
    }
  }

  private send(frame: BridgeFrame): void {
    this.transport.send(frame)
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    for (const queue of this.streams.values()) queue.fail(error)
    this.streams.clear()
  }
}

/** Pull queue for one stream. */
class FrameQueue {
  private readonly values: unknown[] = []
  private readonly waiters: (() => void)[] = []
  private done = false
  private error: Error | undefined

  push(value: unknown): void {
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

  async next(): Promise<IteratorResult<unknown>> {
    for (;;) {
      if (this.values.length > 0) return { done: false, value: this.values.shift() }
      if (this.error !== undefined) throw this.error
      if (this.done) return { done: true, value: undefined }
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }

  private wake(): void {
    const waiters = this.waiters.splice(0)
    for (const waiter of waiters) waiter()
  }
}

/** All live peer links for one node. */
export class PeerPool {
  private nodeId: string
  private readonly transport: BridgeTransport
  private readonly links = new Map<string, PeerLink>()
  private peers: readonly PeerInfo[] = []
  private resolveReady: (() => void) | undefined

  /** Resolves after the first directory arrives. */
  readonly ready: Promise<void>

  constructor(nodeId: string, transport: BridgeTransport) {
    this.nodeId = nodeId
    this.transport = transport
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve
    })
  }

  /** Adopt this node's server id; a changed id invalidates existing links. */
  setNodeId(nodeId: string): void {
    if (this.nodeId === nodeId) return
    this.nodeId = nodeId
    for (const link of this.links.values()) link.close()
    this.links.clear()
  }

  /** Replace the directory and keep links for online peers. */
  update(directory: readonly PeerInfo[]): void {
    this.peers = directory
    this.resolveReady?.()
    this.resolveReady = undefined
    const online = new Set<string>()
    for (const peer of directory) {
      if (peer.nodeId === this.nodeId || !peer.online) continue
      online.add(peer.nodeId)
      if (!this.links.has(peer.nodeId)) {
        this.links.set(peer.nodeId, new PeerLink(this.nodeId, peer.nodeId, this.transport))
      }
    }
    for (const [nodeId, link] of this.links) {
      if (online.has(nodeId)) continue
      link.close()
      this.links.delete(nodeId)
    }
  }

  /** Live directory rows. */
  directory(): readonly PeerInfo[] {
    return this.peers
  }

  /** Link for one online peer. */
  link(nodeId: string): PeerLink | undefined {
    return this.links.get(nodeId)
  }

  /** Route one answer from the server to the peer that asked. */
  handle(frame: BridgeAnswer): void {
    const nodeId = frame.from ?? frame.id.slice(0, frame.id.indexOf(':'))
    this.links.get(nodeId)?.handle(frame)
  }

  /** Ask one peer for its visible Sessions. */
  async sessions(nodeId: string): Promise<readonly unknown[]> {
    const link = this.links.get(nodeId)
    if (link === undefined) return []
    const value = await link.request('session.list', {}) as { items?: readonly unknown[] }
    return value.items ?? []
  }

  /** Close every link. */
  close(): void {
    for (const link of this.links.values()) link.close()
    this.links.clear()
  }
}
