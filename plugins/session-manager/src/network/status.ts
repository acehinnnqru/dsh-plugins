/**
 * Shared Session management status for one node.
 *
 * The owner watches its local Sessions, folds running and pending facts into a
 * status row, and publishes it through the server. Readers on any node send a
 * read acknowledgement back through the same server record, so an owner's
 * browser and every peer agree on which completion is still unread.
 * @module dsh-plugin-session-manager/network/status
 */

import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionStatusRecord, StatusPublishFrame } from './protocol.ts'

/** One local status fact before it gains an owner identity. */
interface LocalStatus {
  running: boolean
  pending: string | null
  unread: boolean
  updatedAt: number
  readAt: number
}

/** Local Session reads the coordinator needs. */
export interface StatusSource {
  list(): Promise<SessionListValue>
  state(sessionId: SessionId): Promise<{ readonly running: boolean; readonly pendingInput: readonly { readonly kind: string }[] }>
}

/** Wire operations supplied once the server link exists. */
export interface StatusPublisher {
  publish(status: StatusPublishFrame): void
  read(sessionId: SessionId, readAt: number): void
}

/** One coordinator over all local and cached remote status rows. */
export class StatusCoordinator {
  private readonly source: StatusSource
  private readonly logger: (message: string) => void
  private readonly local = new Map<string, LocalStatus>()
  private readonly remote = new Map<string, SessionStatusRecord>()
  private localIds = new Set<string>()
  private publisher: StatusPublisher | undefined
  private nodeId: string | undefined
  private timer: NodeJS.Timeout | undefined
  private polling = false
  private running = false

  constructor(source: StatusSource, logger: (message: string) => void) {
    this.source = source
    this.logger = logger
  }

  /** Attach the server operations; called before the first poll. */
  setPublisher(publisher: StatusPublisher | undefined): void {
    this.publisher = publisher
  }

  /** Learn this node's server identity for local rows. */
  setNodeId(nodeId: string | undefined): void {
    this.nodeId = nodeId
  }

  /** Replace or extend the cached server view after a welcome or push. */
  applyServer(records: readonly SessionStatusRecord[]): void {
    for (const record of records) this.applyOne(record)
  }

  /** Apply one pushed server row. */
  applyOne(record: SessionStatusRecord): void {
    this.remote.set(record.sessionId, record)
    const local = this.local.get(record.sessionId)
    if (local !== undefined) {
      local.unread = record.unread
      local.readAt = record.readAt
    }
  }

  /** Publish every local row after the link becomes ready. */
  publishAll(): void {
    for (const [sessionId, local] of this.local) this.publishLocal(sessionId, local)
  }

  /** Start periodic local state sampling. */
  start(): void {
    if (this.running) return
    this.running = true
    void this.poll()
    this.timer = setInterval(() => {
      void this.poll()
    }, 3000)
  }

  /** Stop periodic sampling. */
  stop(): void {
    this.running = false
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  /** React to one local Agent running edge without waiting for the next poll. */
  onRunning(sessionId: string, running: boolean): void {
    this.localIds.add(sessionId)
    const previous = this.local.get(sessionId)
    const unread = running ? false : previous?.running === true ? true : previous?.unread ?? false
    const next: LocalStatus = {
      running,
      pending: previous?.pending ?? null,
      unread,
      // A new stop must outrank every earlier read mark; the list may not have caught up yet.
      updatedAt: Math.max(previous?.updatedAt ?? 0, Date.now()),
      readAt: previous?.readAt ?? 0,
    }
    this.local.set(sessionId, next)
    if (previous === undefined || previous.running !== running || previous.unread !== unread) this.publishLocal(sessionId, next)
  }

  /** Mark one Session read from the browser on this node. */
  markRead(sessionId: SessionId): void {
    const now = Date.now()
    const local = this.local.get(sessionId)
    if (local !== undefined) {
      local.unread = false
      local.readAt = now
      this.publishLocal(sessionId, local)
      return
    }
    const cached = this.remote.get(sessionId)
    if (cached !== undefined) this.remote.set(sessionId, { ...cached, unread: false, readAt: now })
    this.publisher?.read(sessionId, now)
  }

  /** Import an unread completion the owner's browser still holds. */
  async reportUnread(sessionId: SessionId, updatedAt: number): Promise<void> {
    if (!this.localIds.has(sessionId)) {
      try {
        const list = await this.source.list()
        if (!list.items.some((item) => item.sessionId === sessionId)) return
        this.localIds.add(sessionId)
      } catch {
        return
      }
    }
    const cached = this.remote.get(sessionId)
    if (cached !== undefined && cached.readAt >= updatedAt) return
    const previous = this.local.get(sessionId)
    if (previous?.unread === true) return
    const next: LocalStatus = previous === undefined
      ? { running: cached?.running ?? false, pending: cached?.pending ?? null, unread: true, updatedAt, readAt: cached?.readAt ?? 0 }
      : { ...previous, unread: true, updatedAt: Math.max(previous.updatedAt, updatedAt) }
    this.local.set(sessionId, next)
    this.publishLocal(sessionId, next)
  }

  /** All status rows a browser needs, newest revision per Session. */
  snapshot(): readonly SessionStatusRecord[] {
    const result = new Map(this.remote)
    for (const [sessionId, local] of this.local) {
      const cached = this.remote.get(sessionId)
      result.set(sessionId, {
        sessionId,
        ownerNodeId: cached?.ownerNodeId ?? this.nodeId ?? '',
        running: local.running,
        pending: local.pending,
        unread: local.unread,
        updatedAt: local.updatedAt,
        readAt: local.readAt,
        revision: cached?.revision ?? 0,
      })
    }
    return [...result.values()]
  }

  /** Read local state at a bounded cadence and publish only changes. */
  private async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const list = await this.source.list()
      const ids = new Set<string>()
      for (const item of list.items) {
        ids.add(item.sessionId)
        this.localIds.add(item.sessionId)
        let state: { readonly running: boolean; readonly pendingInput: readonly { readonly kind: string }[] }
        try {
          state = await this.source.state(item.sessionId as SessionId)
        } catch {
          continue
        }
        const previous = this.local.get(item.sessionId)
        const cached = this.remote.get(item.sessionId)
        let unread = previous?.unread ?? cached?.unread ?? false
        if (state.running) unread = false
        else if (previous?.running === true) unread = true
        const next: LocalStatus = {
          running: state.running,
          pending: state.pendingInput[0]?.kind ?? null,
          unread,
          updatedAt: Math.max(item.updatedAt, previous?.updatedAt ?? 0),
          readAt: previous?.readAt ?? cached?.readAt ?? 0,
        }
        this.local.set(item.sessionId, next)
        if (previous === undefined || previous.running !== next.running || previous.pending !== next.pending ||
          previous.unread !== next.unread || previous.updatedAt !== next.updatedAt) {
          this.publishLocal(item.sessionId, next)
        }
      }
      for (const id of this.localIds) if (!ids.has(id)) this.localIds.delete(id)
      for (const id of this.local.keys()) if (!ids.has(id)) this.local.delete(id)
    } catch (error) {
      this.logger('session-manager: status poll failed: ' + (error instanceof Error ? error.message : String(error)))
    } finally {
      this.polling = false
    }
  }

  /** Send one local row and keep the cached copy current. */
  private publishLocal(sessionId: string, local: LocalStatus): void {
    if (this.publisher === undefined) return
    const cached = this.remote.get(sessionId)
    const status: SessionStatusRecord = {
      sessionId,
      ownerNodeId: this.nodeId ?? cached?.ownerNodeId ?? '',
      running: local.running,
      pending: local.pending,
      unread: local.unread,
      updatedAt: local.updatedAt,
      readAt: local.readAt,
      revision: (cached?.revision ?? 0) + 1,
    }
    this.remote.set(sessionId, status)
    this.publisher.publish({
      type: 'status.publish',
      v: 1,
      sessionId,
      running: local.running,
      pending: local.pending,
      unread: local.unread,
      updatedAt: local.updatedAt,
    })
  }
}
