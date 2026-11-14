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

/** One running node runtime. */
export class NodeRuntime {
  private readonly logger: (message: string) => void
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
    this.link = new NodeLink({
      server: config.server,
      token: config.token,
      name: config.name.length > 0 ? config.name : hostname(),
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
