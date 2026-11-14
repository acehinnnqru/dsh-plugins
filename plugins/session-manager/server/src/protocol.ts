/**
 * Wire vocabulary for the session-manager server and its nodes.
 *
 * Nodes keep one WebSocket to the server. Directory and presence frames travel
 * on it, and peer Session RPC is bridged through the same socket; the server
 * never opens a listener on a node and never stores Session data.
 * @module session-manager-server/protocol
 */

/** One directory row the server publishes. */
export interface PeerInfo {
  readonly nodeId: string
  readonly name: string
  readonly encKey: string
  readonly signKey: string
  readonly online: boolean
  readonly lastSeen: number
  readonly hostname?: string
  readonly pluginVersion?: string
}

/** First connection: join token plus proof of possession of both node keys. */
export interface RegisterFrame {
  readonly type: 'register'
  readonly v: 1
  readonly token: string
  readonly name: string
  readonly encKey: string
  readonly signKey: string
  readonly ts: number
  readonly proof: string
  /** Group to join; omitted when the server has exactly one group. */
  readonly groupId?: string
  readonly meta?: { readonly hostname?: string; readonly pluginVersion?: string }
}

/** Reconnect: the node proves its stored identity with a signed nonce. */
export interface HelloFrame {
  readonly type: 'hello'
  readonly v: 1
  readonly nodeId: string
  readonly groupId: string
  readonly ts: number
  readonly nonce: string
  readonly signature: string
}

/** Heartbeat answer. */
export interface PongFrame {
  readonly type: 'pong'
}

/** Start or carry one bridged peer operation. */
export interface BridgeRequestFrame {
  readonly type: 'bridge.request'
  readonly v: 1
  readonly id: string
  readonly to: string
  readonly from?: string
  readonly op: string
  readonly args: unknown
}

/** One unary bridge answer. */
export interface BridgeResponseFrame {
  readonly type: 'bridge.response'
  readonly v: 1
  readonly id: string
  readonly to: string
  readonly from?: string
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: { readonly code: string; readonly message: string }
}

/** One streamed bridge frame. */
export interface BridgeStreamFrame {
  readonly type: 'bridge.stream'
  readonly v: 1
  readonly id: string
  readonly to: string
  readonly from?: string
  readonly frame: unknown
}

/** End of one bridged stream. */
export interface BridgeEndFrame {
  readonly type: 'bridge.end'
  readonly v: 1
  readonly id: string
  readonly to: string
  readonly from?: string
}

/** Failure of one bridged operation. */
export interface BridgeErrorFrame {
  readonly type: 'bridge.error'
  readonly v: 1
  readonly id: string
  readonly to: string
  readonly from?: string
  readonly error: { readonly code: string; readonly message: string }
}

/** One Session's shared management status, owned by the node that hosts it. */
export interface SessionStatusRecord {
  readonly sessionId: string
  readonly ownerNodeId: string
  readonly running: boolean
  readonly pending: string | null
  readonly unread: boolean
  readonly updatedAt: number
  readonly readAt: number
  readonly revision: number
}

/** Owner publication of one Session's running, pending, and unread state. */
export interface StatusPublishFrame {
  readonly type: 'status.publish'
  readonly v: 1
  readonly sessionId: string
  readonly running: boolean
  readonly pending: string | null
  readonly unread: boolean
  readonly updatedAt: number
}

/** A reader on any node acknowledging one Session's completion. */
export interface StatusReadFrame {
  readonly type: 'status.read'
  readonly v: 1
  readonly sessionId: string
  readonly readAt: number
}

/** One status row pushed to every node in the group. */
export interface StatusStateFrame {
  readonly type: 'status.state'
  readonly v: 1
  readonly status: SessionStatusRecord
}

/** Consumer cancellation of one bridged stream. */
export interface BridgeCancelFrame {
  readonly type: 'bridge.cancel'
  readonly v: 1
  readonly id: string
  readonly to: string
  readonly from?: string
}

/** Every bridged frame, in both directions. */
export type BridgeFrame =
  | BridgeRequestFrame
  | BridgeResponseFrame
  | BridgeStreamFrame
  | BridgeEndFrame
  | BridgeErrorFrame
  | BridgeCancelFrame

/** Frames a node sends to the server. */
export type ClientFrame = RegisterFrame | HelloFrame | PongFrame | StatusPublishFrame | StatusReadFrame | BridgeFrame

/** Registration or reconnect accepted. */
export interface WelcomeFrame {
  readonly type: 'welcome'
  readonly v: 1
  readonly nodeId: string
  readonly groupId: string
  readonly groupName: string
  readonly directory: readonly PeerInfo[]
  /** Persisted Session management status rows for the group. */
  readonly statuses?: readonly SessionStatusRecord[]
  readonly serverTime: number
}

/** Directory event for an arriving or changing node. */
export interface NodeEventFrame {
  readonly type: 'node.online' | 'node.updated' | 'node.offline'
  readonly v: 1
  readonly peer?: PeerInfo
  readonly nodeId?: string
}

/** Server heartbeat. */
export interface PingFrame {
  readonly type: 'ping'
}

/** Protocol or authentication failure. */
export interface ErrorFrame {
  readonly type: 'error'
  readonly v: 1
  readonly code: string
  readonly message: string
}

/** Frames the server sends to a node. */
export type ServerFrame = WelcomeFrame | NodeEventFrame | PingFrame | ErrorFrame | StatusStateFrame | BridgeFrame

/** Canonical bytes signed by a registration. */
export function canonicalRegister(name: string, encKey: string, signKey: string, ts: number): string {
  return JSON.stringify(['smnet-register-v1', 1, name, encKey, signKey, ts])
}

/** Canonical bytes signed by a reconnect hello. */
export function canonicalHello(nodeId: string, groupId: string, ts: number, nonce: string): string {
  return JSON.stringify(['smnet-hello-v1', 1, nodeId, groupId, ts, nonce])
}
