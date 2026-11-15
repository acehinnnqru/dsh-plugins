/**
 * The single outbound WebSocket from one node to the directory server.
 *
 * Registration happens once with a join token; every later connection proves
 * the stored Ed25519 identity with a signed nonce. Directory, presence, and
 * bridged peer RPC all travel on this one socket, so a node never needs an
 * inbound listener.
 * @module dsh-plugin-session-manager/network/node
 */

import { WebSocket } from 'ws'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  canonicalHello,
  canonicalRegister,
  type BridgeEndFrame,
  type BridgeErrorFrame,
  type BridgeFrame,
  type BridgeRequestFrame,
  type BridgeResponseFrame,
  type BridgeStreamFrame,
  type ClientFrame,
  type ErrorFrame,
  type HelloFrame,
  type NodeEventFrame,
  type PeerInfo,
  type RegisterFrame,
  type ServerFrame,
  type SessionStatusRecord,
  type StatusPublishFrame,
  type StatusReadFrame,
  type WelcomeFrame,
} from './protocol.ts'
import { loadInstance } from './instance.ts'
import {
  createIdentity,
  loadIdentity,
  nonce,
  saveIdentity,
  signIdentity,
  type Identity,
} from './identity.ts'

/** A bridge request that reached this node, with the authenticated sender. */
export type IncomingBridgeRequest = BridgeRequestFrame & { readonly from: string }

/** A bridge answer routed back to this node. */
export type IncomingBridgeAnswer = BridgeResponseFrame | BridgeStreamFrame | BridgeEndFrame | BridgeErrorFrame

/** Configuration the node link needs. */
export interface NodeLinkOptions {
  readonly server: string
  readonly token: string
  readonly name: string
  /** Group id to join; empty keeps the single-group compatibility path. */
  readonly group: string
  readonly logger: (message: string) => void
  readonly onDirectory: (directory: readonly PeerInfo[], self: SessionId | undefined) => void
  readonly onBridgeRequest: (frame: IncomingBridgeRequest) => void
  readonly onBridgeCancel: (id: string) => void
  readonly onBridgeAnswer: (frame: IncomingBridgeAnswer) => void
  readonly onStatusSnapshot?: (statuses: readonly SessionStatusRecord[]) => void
  readonly onStatus?: (status: SessionStatusRecord) => void
}

/** Normalize a configured server URL to a WebSocket endpoint. */
export function serverUrl(value: string): string {
  const url = new URL(value)
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:'
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/v1/node'
  return url.toString()
}

/** One outbound server link. */
export class NodeLink {
  private readonly options: NodeLinkOptions
  private identity: Identity | undefined
  private instanceId: string | undefined
  private socket: WebSocket | undefined
  private stopped = false
  private retryMs = 1000
  private timer: NodeJS.Timeout | undefined
  private directory: readonly PeerInfo[] = []
  private ready = false
  private readonly pendingReads = new Map<string, number>()

  constructor(options: NodeLinkOptions) {
    this.options = options
  }

  /** Current directory, including this node. */
  peers(): readonly PeerInfo[] {
    return this.directory
  }

  /** This node's server id, once registered. */
  nodeId(): SessionId | undefined {
    return this.identity?.nodeId as SessionId | undefined
  }

  /** Current identity, including the server-assigned group and node ids. */
  currentIdentity(): Identity | undefined {
    return this.identity
  }

  /** Send one bridged frame to the server; a closed link drops it. */
  sendBridge(frame: BridgeFrame): void {
    this.send(this.socket, frame)
  }

  /** Publish one owned Session status row; pre-welcome sockets drop it. */
  publishStatus(status: StatusPublishFrame): void {
    if (this.ready) this.send(this.socket, status)
  }

  /** Acknowledge one Session completion on behalf of this node's browser. */
  publishRead(sessionId: SessionId, readAt: number): void {
    if (!this.ready) {
      this.pendingReads.set(sessionId, readAt)
      return
    }
    const frame: StatusReadFrame = { type: 'status.read', v: 1, sessionId, readAt }
    this.send(this.socket, frame)
  }

  /** Open the link and keep it alive until close(). */
  async start(): Promise<void> {
    this.instanceId = (await loadInstance()).id
    this.identity = await loadIdentity(this.options.server)
    const desiredGroup = this.options.group
    if (this.identity !== undefined && desiredGroup.length > 0 &&
      this.identity.groupId !== undefined && this.identity.groupId !== desiredGroup) {
      // The configuration selects another group; register again instead of helloing the old one.
      this.identity = { ...this.identity, nodeId: undefined, groupId: undefined }
    }
    if (this.identity === undefined) {
      if (this.options.token.length === 0) {
        this.options.logger('session-manager: no identity and no join token; network disabled')
        return
      }
      this.identity = createIdentity(this.options.server, this.options.name)
    }
    this.connect()
  }

  /** Stop reconnecting and close the socket. */
  close(): void {
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.socket?.close(1000, 'client stopping')
    this.socket = undefined
  }

  private connect(): void {
    if (this.stopped) return
    const identity = this.identity
    if (identity === undefined) return
    const socket = new WebSocket(serverUrl(this.options.server))
    this.socket = socket

    socket.on('open', () => {
      this.ready = false
      this.retryMs = 1000
      if (identity.nodeId === undefined || identity.groupId === undefined) {
        this.sendRegister(socket, identity)
        return
      }
      this.sendHello(socket, identity)
    })

    socket.on('message', (data) => {
      this.handle(socket, data)
    })

    socket.on('close', () => {
      this.ready = false
      if (this.socket === socket) this.socket = undefined
      this.retry()
    })

    socket.on('error', () => {
      // The close event owns reconnect scheduling.
    })
  }

  private retry(): void {
    if (this.stopped) return
    const delay = this.retryMs
    this.retryMs = Math.min(this.retryMs * 2, 30_000)
    this.timer = setTimeout(() => this.connect(), delay)
  }

  private send(socket: WebSocket | undefined, frame: ClientFrame): void {
    if (socket?.readyState === 1) socket.send(JSON.stringify(frame))
  }

  private sendRegister(socket: WebSocket, identity: Identity): void {
    const ts = Date.now()
    const frame: RegisterFrame = {
      type: 'register',
      v: 1,
      token: this.options.token,
      name: this.options.name,
      encKey: identity.encKey,
      signKey: identity.signKey,
      ts,
      proof: signIdentity(identity, canonicalRegister(this.options.name, identity.encKey, identity.signKey, ts)),
      ...(this.options.group.length === 0 ? {} : { groupId: this.options.group }),
      ...(this.instanceId === undefined ? {} : { instanceId: this.instanceId }),
      meta: { hostname: this.options.name, pluginVersion: '0.0.0' },
    }
    this.send(socket, frame)
  }

  private sendHello(socket: WebSocket, identity: Identity): void {
    const ts = Date.now()
    const value = nonce()
    const frame: HelloFrame = {
      type: 'hello',
      v: 1,
      nodeId: identity.nodeId ?? '',
      groupId: identity.groupId ?? '',
      ts,
      nonce: value,
      signature: signIdentity(identity, canonicalHello(identity.nodeId ?? '', identity.groupId ?? '', ts, value)),
      ...(this.instanceId === undefined ? {} : { instanceId: this.instanceId }),
      name: this.options.name,
    }
    this.send(socket, frame)
  }

  private handle(socket: WebSocket, data: unknown): void {
    let frame: ServerFrame
    try {
      frame = JSON.parse(typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : String(data)) as ServerFrame
    } catch {
      this.options.logger('session-manager: malformed server frame')
      return
    }
    if (frame.type === 'ping') {
      this.send(socket, { type: 'pong' })
      return
    }
    if (frame.type === 'error') {
      this.onError(frame)
      return
    }
    if (frame.type === 'welcome') {
      void this.onWelcome(frame).catch((error: unknown) => {
        this.options.logger('session-manager: welcome failed: ' + (error instanceof Error ? error.message : String(error)))
      })
      return
    }
    if (frame.type === 'node.online' || frame.type === 'node.updated' || frame.type === 'node.offline') {
      this.onNodeEvent(frame)
      return
    }
    if (frame.type === 'status.state') {
      this.options.onStatus?.(frame.status)
      return
    }
    if (frame.type === 'bridge.request') {
      if (typeof frame.from === 'string' && frame.from.length > 0) {
        this.options.onBridgeRequest({ ...frame, from: frame.from })
      }
      return
    }
    if (frame.type === 'bridge.cancel') {
      this.options.onBridgeCancel(frame.id)
      return
    }
    if (
      frame.type === 'bridge.response' ||
      frame.type === 'bridge.stream' ||
      frame.type === 'bridge.end' ||
      frame.type === 'bridge.error'
    ) {
      this.options.onBridgeAnswer(frame)
    }
  }

  private async onWelcome(frame: WelcomeFrame): Promise<void> {
    const identity = this.identity
    if (identity === undefined) return
    if (identity.nodeId !== frame.nodeId || identity.groupId !== frame.groupId) {
      this.identity = {
        ...identity,
        nodeId: frame.nodeId,
        groupId: frame.groupId,
      }
      await saveIdentity(this.identity)
    }
    this.ready = true
    this.directory = frame.directory
    this.options.onStatusSnapshot?.(frame.statuses ?? [])
    for (const [sessionId, readAt] of this.pendingReads) {
      this.send(this.socket, { type: 'status.read', v: 1, sessionId: sessionId as SessionId, readAt })
    }
    this.pendingReads.clear()
    this.options.onDirectory(this.directory, frame.nodeId as SessionId)
  }

  private onNodeEvent(frame: NodeEventFrame): void {
    if (frame.type === 'node.offline') {
      const nodeId = frame.nodeId
      if (nodeId === undefined) return
      this.directory = this.directory.map((peer) => peer.nodeId === nodeId ? { ...peer, online: false, lastSeen: Date.now() } : peer)
      this.options.onDirectory(this.directory, this.identity?.nodeId as SessionId | undefined)
      return
    }
    const peer = frame.peer
    if (peer === undefined) return
    const found = this.directory.some((item) => item.nodeId === peer.nodeId)
    this.directory = found
      ? this.directory.map((item) => item.nodeId === peer.nodeId ? peer : item)
      : [...this.directory, peer]
    this.options.onDirectory(this.directory, this.identity?.nodeId as SessionId | undefined)
  }

  private onError(frame: ErrorFrame): void {
    this.options.logger('session-manager: server error ' + frame.code + ': ' + frame.message)
    if (frame.code === 'auth/unauthorized' && this.identity?.nodeId !== undefined) {
      // A wiped server state is recoverable only with a token.
      if (this.options.token.length > 0) {
        this.identity = { ...this.identity, nodeId: undefined, groupId: undefined }
        this.socket?.close(4000, 're-register')
      }
    }
  }
}
