/**
 * Browser mirror of the shared Session management status.
 *
 * The Host owns the authoritative read/unread record; this store only polls the
 * authenticated route and forwards browser read acknowledgements back to it.
 * @module dsh-plugin-session-manager/client/status
 */

/** One status row as the browser sees it. */
export interface SharedStatus {
  readonly sessionId: string
  readonly running: boolean
  readonly pending: string | null
  readonly unread: boolean
  readonly updatedAt: number
  readonly readAt: number
}

/** Snapshot map indexed by Session id. */
export type SharedStatusSnapshot = ReadonlyMap<string, SharedStatus>

/** Polling mirror with explicit read acknowledgement. */
export class SharedStatusStore {
  private current: SharedStatusSnapshot = new Map()
  private readonly listeners = new Set<() => void>()
  private readonly reported = new Map<string, number>()
  private readonly optimisticRunning = new Map<string, number>()
  private timer: NodeJS.Timeout | undefined
  private stopped = true
  private inFlight = false

  /** Stable snapshot for useSyncExternalStore. */
  getSnapshot = (): SharedStatusSnapshot => this.current

  /** Subscribe to snapshot replacements. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Start polling as soon as the client is mounted. */
  start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.refresh()
    if (typeof setInterval !== 'function') return
    this.timer = setInterval(() => {
      void this.refresh()
    }, 1000)
  }

  /** Stop polling; the page can restart it on the next mount. */
  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  /**
   * Reflect a locally observed running edge before the next shared poll.
   *
   * The native Session stream knows a submitted prompt started the turn before
   * the three-second status poll returns, so the board would otherwise classify
   * a fresh remote turn as Recent.
   * @param sessionId - Session whose turn started.
   */
  noteRunning(sessionId: string): void {
    if (!this.optimisticRunning.has(sessionId)) this.optimisticRunning.set(sessionId, Date.now())
    const current = this.current.get(sessionId)
    const nextRow: SharedStatus = current === undefined
      ? {
          sessionId,
          running: true,
          pending: null,
          unread: false,
          updatedAt: Date.now(),
          readAt: 0,
        }
      : current.running
        ? current
        : { ...current, running: true, unread: false }
    if (nextRow === current) return
    const next = new Map(this.current)
    next.set(sessionId, nextRow)
    this.publish(next)
  }

  /** Mark one Session read on the Host and clear the local row immediately. */
  async read(sessionId: string): Promise<void> {
    const current = this.current.get(sessionId)
    if (current !== undefined && current.unread) {
      const next = new Map(this.current)
      next.set(sessionId, { ...current, unread: false, readAt: Date.now() })
      this.publish(next)
    }
    try {
      await fetch('/api/session-manager/read', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
    } catch {
      // The next poll reconciles a transient route failure.
    }
  }

  /** Import one unread completion that predates the shared record. */
  async report(sessionId: string, updatedAt: number): Promise<void> {
    if ((this.reported.get(sessionId) ?? Number.NEGATIVE_INFINITY) >= updatedAt) return
    this.reported.set(sessionId, updatedAt)
    try {
      const response = await fetch('/api/session-manager/report', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, updatedAt }),
      })
      if (!response.ok) this.reported.delete(sessionId)
    } catch {
      this.reported.delete(sessionId)
    }
  }

  /** Pull the Host snapshot; a failed poll leaves the previous rows in place. */
  async refresh(): Promise<void> {
    if (this.inFlight || this.stopped || typeof fetch !== 'function') return
    this.inFlight = true
    try {
      const response = await fetch('/api/session-manager/status', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) return
      const body = await response.json() as { readonly statuses?: readonly SharedStatus[] }
      if (!Array.isArray(body.statuses)) return
      const next = new Map<string, SharedStatus>()
      for (const status of body.statuses) {
        if (typeof status.sessionId !== 'string') continue
        next.set(status.sessionId, {
          sessionId: status.sessionId,
          running: status.running === true,
          pending: typeof status.pending === 'string' ? status.pending : null,
          unread: status.unread === true,
          updatedAt: typeof status.updatedAt === 'number' ? status.updatedAt : 0,
          readAt: typeof status.readAt === 'number' ? status.readAt : 0,
        })
      }
      const now = Date.now()
      for (const [sessionId, notedAt] of this.optimisticRunning) {
        const row = next.get(sessionId)
        if (row?.running === true || (row !== undefined && row.updatedAt > notedAt)) {
          this.optimisticRunning.delete(sessionId)
          continue
        }
        if (now - notedAt > 5000) {
          this.optimisticRunning.delete(sessionId)
          continue
        }
        const base = row ?? this.current.get(sessionId)
        if (base !== undefined) next.set(sessionId, { ...base, running: true, unread: false })
      }
      if (sameStatuses(this.current, next)) return
      this.publish(next)
    } catch {
      // A transient Host restart or reconnect leaves the old snapshot visible.
    } finally {
      this.inFlight = false
    }
  }

  private publish(next: SharedStatusSnapshot): void {
    this.current = next
    for (const listener of this.listeners) listener()
  }
}

/** Compare two snapshots by every rendered fact. */
function sameStatuses(left: SharedStatusSnapshot, right: SharedStatusSnapshot): boolean {
  if (left.size !== right.size) return false
  for (const [sessionId, value] of left) {
    const other = right.get(sessionId)
    if (other === undefined || other.running !== value.running || other.pending !== value.pending ||
      other.unread !== value.unread || other.updatedAt !== value.updatedAt || other.readAt !== value.readAt) return false
  }
  return true
}
