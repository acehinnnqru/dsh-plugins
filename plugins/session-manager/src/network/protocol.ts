/**
 * Wire frames for the node-server link and its bridged peer RPC.
 *
 * Kept separate from the server package so the plugin never imports server
 * runtime code; the two copies share the canonical strings pinned by tests.
 * @module dsh-plugin-session-manager/network/protocol
 */

import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/types'

/** Server directory row. */
export interface PeerInfo {
  readonly nodeId: string
  readonly name: string
  readonly encKey: string
  readonly signKey: string
  readonly online: boolean
  readonly lastSeen: number
  readonly hostname?: string
  readonly pluginVersion?: string
  /** Stable installation hash reported by the node. */
  readonly instanceId?: string
}

/** First registration with a join token. */
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
  /** Stable installation hash generated in the DSH home. */
  readonly instanceId?: string
  readonly meta?: { readonly hostname?: string; readonly pluginVersion?: string }
}

/** Reconnect with a signed nonce. */
export interface HelloFrame {
  readonly type: 'hello'
  readonly v: 1
  readonly nodeId: string
  readonly groupId: string
  readonly ts: number
  readonly nonce: string
  readonly signature: string
  /** Stable installation hash; binds the reconnect to this installation. */
  readonly instanceId?: string
  /** Updated display name; omitted keeps the stored name. */
  readonly name?: string
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

/** Consumer cancellation of one bridged stream. */
export interface BridgeCancelFrame {
  readonly type: 'bridge.cancel'
  readonly v: 1
  readonly id: string
  readonly to: string
  readonly from?: string
}

/** One Session's shared management status, owned by the hosting node. */
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

/** Owner publication of one Session status row. */
export interface StatusPublishFrame {
  readonly type: 'status.publish'
  readonly v: 1
  readonly sessionId: string
  readonly running: boolean
  readonly pending: string | null
  readonly unread: boolean
  readonly updatedAt: number
}

/** A reader on any node acknowledging one Session completion. */
export interface StatusReadFrame {
  readonly type: 'status.read'
  readonly v: 1
  readonly sessionId: string
  readonly readAt: number
}

/** One status row pushed by the server. */
export interface StatusStateFrame {
  readonly type: 'status.state'
  readonly v: 1
  readonly status: SessionStatusRecord
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

/** Accepted registration or reconnect. */
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

/** Directory event. */
export interface NodeEventFrame {
  readonly type: 'node.online' | 'node.updated' | 'node.offline'
  readonly v: 1
  readonly peer?: PeerInfo
  readonly nodeId?: string
}

/** Heartbeat. */
export interface PingFrame {
  readonly type: 'ping'
}

/** Failure. */
export interface ErrorFrame {
  readonly type: 'error'
  readonly v: 1
  readonly code: string
  readonly message: string
}

/** Frames the server sends. */
export type ServerFrame = WelcomeFrame | NodeEventFrame | PingFrame | ErrorFrame | StatusStateFrame | BridgeFrame

/** Canonical registration bytes. */
export function canonicalRegister(name: string, encKey: string, signKey: string, ts: number): string {
  return JSON.stringify(['smnet-register-v1', 1, name, encKey, signKey, ts])
}

/** Canonical reconnect bytes. */
export function canonicalHello(nodeId: string, groupId: string, ts: number, nonce: string): string {
  return JSON.stringify(['smnet-hello-v1', 1, nodeId, groupId, ts, nonce])
}

/** One remote Session row the peer returns. */
export type RemoteSessionSummary = SessionSummary
