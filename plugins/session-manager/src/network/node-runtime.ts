/**
 * One node's network runtime: the server link, the bridge responder that serves
 * this host's Sessions, and the Session Controller federation that exposes
 * remote rows to the native UI.
 * @module dsh-plugin-session-manager/network/node-runtime
 */

import { hostname } from 'node:os'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PeerInfo, SessionStatusRecord, StatusPublishFrame } from './protocol.ts'
import { NodeLink } from './node.ts'
import { PeerPool } from './peer-client.ts'
import { createPeerResponder, type PeerResponder } from './peer-responder.ts'
import { installFederation } from './federation.ts'

/** Network configuration contributed by the plugin profile. */
export interface NetworkConfig {
  readonly server: string
  readonly token: string
  readonly name: string
  /** Group id to join; empty keeps the single-group compatibility path. */
  readonly group: string
}

/** One node the picker can start a Session on. */
export interface RuntimeNode {
  readonly nodeId: string | undefined
  readonly name: string
  readonly self: boolean
  readonly instanceId?: string
}

/** One running node runtime. */
export class NodeRuntime {
  private readonly logger: (message: string) => void
  private readonly name: string
  private readonly link: NodeLink
  private readonly responder: PeerResponder
  private readonly pool: PeerPool
  private readonly disposeFederation: () => void
  private poolNodeId: string | undefined
  private announced = false

  constructor(
    config: NetworkConfig,
    controller: object,
    logger: (message: string) => void,
    onStatusSnapshot?: (statuses: readonly SessionStatusRecord[]) => void,
    onStatus?: (status: SessionStatusRecord) => void,
  ) {
    this.logger = logger
    this.name = config.name.length > 0 ? config.name : hostname()
    this.link = new NodeLink({
      server: config.server,
      token: config.token,
      name: this.name,
      group: config.group,
      logger,
      onDirectory: (directory, self) => this.onDirectory(directory, self),
      onBridgeRequest: (frame) => this.responder.handle(frame),
      onBridgeCancel: (id) => this.responder.cancel(id),
      onBridgeAnswer: (frame) => this.pool.handle(frame),
      ...(onStatusSnapshot === undefined ? {} : { onStatusSnapshot }),
      ...(onStatus === undefined ? {} : { onStatus }),
    })
    this.pool = new PeerPool('', {
      send: (frame) => this.link.sendBridge(frame),
    })
    this.disposeFederation = installFederation(controller, this.pool)
    this.responder = createPeerResponder({
      controller,
      logger,
      sender: (frame) => this.link.sendBridge(frame),
    })
  }

  /** The group directory with this node first, for the new-session picker. */
  nodes(): readonly RuntimeNode[] {
    const selfId = this.link.nodeId()
    const peers = this.link.peers()
    const self = peers.find((peer) => peer.nodeId === selfId)
    return [
      {
        nodeId: selfId,
        name: this.name,
        self: true,
        ...(self?.instanceId === undefined ? {} : { instanceId: self.instanceId }),
      },
      ...peers
        .filter((peer) => peer.online && peer.nodeId !== selfId)
        .map((peer) => ({
          nodeId: peer.nodeId,
          name: peer.name,
          self: false,
          ...(peer.instanceId === undefined ? {} : { instanceId: peer.instanceId }),
        })),
    ]
  }

  /** Create one blank Session on one peer through the bridge. */
  async createSession(peerNodeId: string, request: { readonly cwd: string; readonly agentPreset?: string }): Promise<{ readonly sessionId: string }> {
    const link = this.pool.link(peerNodeId)
    if (link === undefined) throw new Error('peer is offline')
    return await link.request('session.create', request) as { readonly sessionId: string }
  }

  /** Publish one owned Session status row. */
  publishStatus(status: StatusPublishFrame): void {
    this.link.publishStatus(status)
  }

  /** Acknowledge a read on any node. */
  publishRead(sessionId: string, readAt: number): void {
    this.link.publishRead(sessionId as SessionId, readAt)
  }

  /** Start the directory link. */
  async start(): Promise<void> {
    await this.link.start()
  }

  /** Stop every link and listener. */
  close(): void {
    this.link.close()
    this.responder.close()
    this.disposeFederation()
    this.pool.close()
    this.poolNodeId = undefined
  }

  private onDirectory(directory: readonly PeerInfo[], self: string | undefined): void {
    const identity = this.link.currentIdentity()
    if (identity?.groupId === undefined || identity.nodeId === undefined || self === undefined) return
    if (!this.announced) {
      this.announced = true
      this.logger('session-manager: federation installed for group ' + identity.groupId)
    }
    if (this.poolNodeId !== identity.nodeId) {
      this.pool.setNodeId(identity.nodeId)
      this.poolNodeId = identity.nodeId
    }
    this.pool.update(directory)
  }
}
