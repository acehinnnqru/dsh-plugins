/**
 * Shared Session management status for one node.
 *
 * The owner watches its local Sessions, folds running and pending facts into a
 * status row, and publishes it through the server. Readers on any node send a
 * read acknowledgement back through the same server record, so an owner's
 * browser and every peer agree on which completion is still unread.
 *
 * Rows are maintained incrementally. Live edges and activity arrive as Host
 * events, pending input is read from the in-memory remote-event registry, and
 * Session storage is listed only for the boot baseline and a slow reconcile.
 * One listing costs a header read per stored Session, so it must never sit on a
 * timer measured in seconds.
 * @module dsh-plugin-session-manager/network/status
 */

import type { SessionListValue, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/types'
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
  /** One complete local listing; the only call that touches Session storage. */
  list(): Promise<SessionListValue>
  /** Pending-input kinds per Session, read from the in-memory remote-event registry. */
  pending(): ReadonlyMap<string, readonly string[]>
}

/** One row-level change the coordinator cannot emit as a status frame. */
export type StatusChange =
  | { readonly kind: 'added'; readonly summary: SessionSummary }
  | { readonly kind: 'removed'; readonly sessionId: string }

/** Wire operations supplied once the server link exists. */
export interface StatusPublisher {
  publish(status: StatusPublishFrame): void
  read(sessionId: SessionId, readAt: number): void
}

/** Pending-input re-read cadence; memory only, never storage. */
const PENDING_TICK_MS = 1_000

/** Cold-baseline reconcile cadence; one header read per stored Session. */
const RECONCILE_INTERVAL_MS = 10 * 60 * 1000

/**
 * Whether one list row is owned by another node through federation.
 * @param summary - one list row.
 * @returns true when the row carries a peer node projection.
 */
export function isFederatedSummary(summary: SessionSummary): boolean {
  const values = summary.projections?.values as Readonly<Record<string, unknown>> | undefined
  const node = values?.['sessionManagerNode']
  return typeof node === 'object' && node !== null && typeof (node as { readonly name?: unknown }).name === 'string'
}

/** One coordinator over all local and cached remote status rows. */
export class StatusCoordinator {
  private readonly source: StatusSource
  private readonly logger: (message: string) => void
  private readonly local = new Map<string, LocalStatus>()
  private readonly remote = new Map<string, SessionStatusRecord>()
  private readonly localIds = new Set<string>()
  /** Identities owned by another node; local facts never apply to them. */
  private readonly federated = new Set<string>()
  /** Consecutive listings that missed a row, so one stale listing cannot drop it. */
  private readonly missed = new Map<string, number>()
  private publisher: StatusPublisher | undefined
  private nodeId: string | undefined
  private pendingTimer: NodeJS.Timeout | undefined
  private reconcileTimer: NodeJS.Timeout | undefined
  private reconciling: Promise<void> | undefined
  private seeded: Promise<void> | undefined
  private baseline = false
  private running = false

  /**
   * @param source - local listing plus the in-memory pending registry.
   * @param logger - diagnostics sink.
   * @param changed - receives rows a reconcile discovered or dropped, so they can
   *   be published as Host events; the boot baseline reports nothing.
   */
  constructor(
    source: StatusSource,
    logger: (message: string) => void,
    private readonly changed?: (change: StatusChange) => void,
  ) {
    this.source = source
    this.logger = logger
  }

  /** Attach the server operations; called before the first publish. */
  setPublisher(publisher: StatusPublisher | undefined): void {
    this.publisher = publisher
  }

  /** Learn this node's server identity for local rows. */
  setNodeId(nodeId: string | undefined): void {
    this.nodeId = nodeId
  }

  /** Drop cached peer status rows, for example when the runtime switches groups. */
  clearRemote(): void {
    this.remote.clear()
  }

  /** Whether the boot baseline merged, so local identities are known. */
  hasBaseline(): boolean {
    return this.baseline
  }

  /**
   * Whether one identity is a local row of this host.
   * @param sessionId - Session identity to test.
   * @returns true for a locally owned row.
   */
  isLocal(sessionId: string): boolean {
    return this.localIds.has(sessionId)
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

  /**
   * Mark one identity as owned by another node.
   *
   * A federated identity is never a local row: its status belongs to the owner
   * and arrives through the server record. Without this, a local copy would
   * shadow the owner's row and a missed edge would pin it forever.
   * @param sessionId - federated Session identity.
   */
  noteFederated(sessionId: string): void {
    this.federated.add(sessionId)
    // The owner's row is the authority; a cached copy published from here would
    // shadow it until the next server push.
    this.remote.delete(sessionId)
    this.local.delete(sessionId)
    this.localIds.delete(sessionId)
    this.missed.delete(sessionId)
  }

  /**
   * Release one identity that is local again, or no longer listed.
   * @param sessionId - Session identity to forget.
   */
  forgetFederated(sessionId: string): void {
    this.federated.delete(sessionId)
  }

  /** Publish every local row after the link becomes ready. */
  publishAll(): void {
    for (const [sessionId, local] of this.local) this.publishLocal(sessionId, local)
  }

  /**
   * Start incremental status tracking.
   *
   * The boot baseline is the only full listing; every later row change is an
   * event, and pending input is sampled from memory once per second.
   */
  start(): void {
    if (this.running) return
    this.running = true
    this.seeded = this.reconcile()
    this.pendingTimer = setInterval(() => {
      this.syncPending()
    }, PENDING_TICK_MS)
    this.pendingTimer.unref?.()
    this.reconcileTimer = setInterval(() => {
      void this.reconcile()
    }, RECONCILE_INTERVAL_MS)
    this.reconcileTimer.unref?.()
  }

  /** Stop the memory sampler and the slow reconcile. */
  stop(): void {
    this.running = false
    if (this.pendingTimer !== undefined) clearInterval(this.pendingTimer)
    if (this.reconcileTimer !== undefined) clearInterval(this.reconcileTimer)
    this.pendingTimer = undefined
    this.reconcileTimer = undefined
  }

  /**
   * Merge one full local listing into the index.
   *
   * This is the boot baseline and the slow drift repair, not a polling path: a
   * listing reads every stored Session header.
   * @returns completion of this or the already-running listing.
   */
  reconcile(): Promise<void> {
    if (this.reconciling !== undefined) return this.reconciling
    const operation = (async () => {
      try {
        const list = await this.source.list()
        this.merge(list.items)
      } catch (error) {
        this.logger('session-manager: status reconcile failed: ' + (error instanceof Error ? error.message : String(error)))
      } finally {
        this.reconciling = undefined
      }
    })()
    this.reconciling = operation
    return operation
  }

  /** Apply one live Session row pushed by the Host. */
  onAdded(summary: SessionSummary): void {
    // A federated row belongs to another node; its shared status is already
    // authoritative and must not be replaced by a local row.
    if (isFederatedSummary(summary) || this.federated.has(summary.sessionId)) return
    this.apply(summary)
  }

  /**
   * Apply one disposal edge.
   *
   * Disposal releases the live Agent only: the Session stays persisted and
   * stays a visible row, so the identity is kept and only the running edge is
   * cleared.
   * @param sessionId - disposed Session identity.
   */
  onRemoved(sessionId: string): void {
    if (this.federated.has(sessionId)) return
    const local = this.local.get(sessionId)
    if (local === undefined || !local.running) return
    local.running = false
    this.publishLocal(sessionId, local)
  }

  /**
   * Advance one row's ordering timestamp from a durable user message.
   * @param sessionId - Session whose activity moved.
   * @param updatedAt - durable message time.
   */
  onActivity(sessionId: string, updatedAt: number): void {
    if (this.federated.has(sessionId)) return
    const local = this.local.get(sessionId)
    if (local === undefined || updatedAt <= local.updatedAt) return
    local.updatedAt = updatedAt
    this.publishLocal(sessionId, local)
  }

  /** React to one local Agent running edge without waiting for the next sample. */
  onRunning(sessionId: string, running: boolean): void {
    // A running edge for a federated Session is the owner's fact, relayed here
    // for the browser only; this node must not publish it as its own row.
    if (this.federated.has(sessionId)) return
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
    if (this.federated.has(sessionId)) return
    if (!this.localIds.has(sessionId)) {
      // The boot baseline is the only listing that can still introduce this
      // identity, so wait for it instead of listing again.
      await this.seeded
      if (!this.localIds.has(sessionId)) return
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

  /** Merge one listing and drop rows storage no longer reports. */
  private merge(items: readonly SessionSummary[]): void {
    const first = !this.baseline
    const seen = new Set<string>()
    for (const item of items) {
      if (isFederatedSummary(item)) continue
      seen.add(item.sessionId)
      this.missed.delete(item.sessionId)
      const known = this.local.has(item.sessionId)
      this.apply(item)
      // A later reconcile discovers Sessions another process stored. The boot
      // baseline reports nothing: the browser lists storage itself at start.
      if (!first && !known) this.changed?.({ kind: 'added', summary: item })
    }
    for (const [sessionId, local] of this.local) {
      // A running Session is live by definition; a listing that missed it is stale.
      if (seen.has(sessionId) || local.running) continue
      // A Session created while this listing was being read is missing from it.
      // Two consecutive misses mean storage really no longer has the row.
      const missed = (this.missed.get(sessionId) ?? 0) + 1
      if (missed < 2) {
        this.missed.set(sessionId, missed)
        continue
      }
      this.missed.delete(sessionId)
      this.local.delete(sessionId)
      this.localIds.delete(sessionId)
      if (!first) this.changed?.({ kind: 'removed', sessionId })
    }
    this.baseline = true
  }

  /** Upsert one local row from a listing row or a pushed summary. */
  private apply(summary: SessionSummary): void {
    const sessionId = summary.sessionId
    // A federated identity stays owned by the other node even when it shows up
    // in this host's listing, for example when both nodes share one home.
    if (this.federated.has(sessionId)) return
    this.localIds.add(sessionId)
    const previous = this.local.get(sessionId)
    const cached = this.remote.get(sessionId)
    // A listing can add a running edge; a stop edge only ever arrives as an event.
    const running = summary.running || previous?.running === true
    let unread = previous?.unread ?? cached?.unread ?? false
    if (running) unread = false
    else if (previous?.running === true) unread = true
    const next: LocalStatus = {
      running,
      pending: previous?.pending ?? null,
      unread,
      updatedAt: Math.max(summary.updatedAt, previous?.updatedAt ?? 0),
      readAt: previous?.readAt ?? cached?.readAt ?? 0,
    }
    this.local.set(sessionId, next)
    if (previous === undefined || previous.running !== next.running || previous.pending !== next.pending ||
      previous.unread !== next.unread || previous.updatedAt !== next.updatedAt) {
      this.publishLocal(sessionId, next)
    }
  }

  /** Re-read pending input from memory and publish only rows that changed. */
  private syncPending(): void {
    let pending: ReadonlyMap<string, readonly string[]>
    try {
      pending = this.source.pending()
    } catch (error) {
      this.logger('session-manager: status pending read failed: ' + (error instanceof Error ? error.message : String(error)))
      return
    }
    for (const [sessionId, local] of this.local) {
      const next = pending.get(sessionId)?.[0] ?? null
      if (next === local.pending) continue
      local.pending = next
      this.publishLocal(sessionId, local)
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
