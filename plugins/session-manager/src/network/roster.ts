/**
 * Incremental Session roster between two nodes.
 *
 * A peer serves one long-lived `session.roster` stream per subscriber: one
 * snapshot of its local list, then one frame per live change. The subscriber
 * keeps its remote rows current without asking any node for a full list, which
 * is what a listing costs — one header read per stored Session.
 * @module dsh-plugin-session-manager/network/roster
 */

import type { SessionListValue, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/types'

/** Liveness frame; the subscriber treats silence as a stalled stream. */
export const ROSTER_HEARTBEAT_MS = 15_000

/** One roster stream frame. */
export type RosterFrame =
  | { readonly type: 'roster/snapshot'; readonly items: readonly SessionSummary[] }
  | { readonly type: 'roster/added'; readonly summary: SessionSummary }
  | { readonly type: 'roster/removed'; readonly sessionId: string }
  | { readonly type: 'roster/status'; readonly sessionId: string; readonly running: boolean }
  | { readonly type: 'roster/activity'; readonly sessionId: string; readonly updatedAt: number }
  | { readonly type: 'roster/heartbeat' }

/** Local reads and live edges one roster stream observes. */
export interface RosterSource {
  /** One local listing; federated rows must never appear here. */
  list(): Promise<SessionListValue>
  /** Subscribe to local change frames; the disposer detaches the listeners. */
  subscribe(emit: (frame: RosterFrame) => void): () => void
}

/** Validate one frame off the bridge before it reaches the row map. */
export function isRosterFrame(value: unknown): value is RosterFrame {
  if (typeof value !== 'object' || value === null) return false
  const frame = value as { readonly type?: unknown; readonly sessionId?: unknown; readonly running?: unknown; readonly updatedAt?: unknown; readonly items?: unknown; readonly summary?: unknown }
  switch (frame.type) {
    case 'roster/snapshot':
      return Array.isArray(frame.items)
    case 'roster/added':
      return typeof frame.summary === 'object' && frame.summary !== null
    case 'roster/removed':
      return typeof frame.sessionId === 'string'
    case 'roster/status':
      return typeof frame.sessionId === 'string' && typeof frame.running === 'boolean'
    case 'roster/activity':
      return typeof frame.sessionId === 'string' && typeof frame.updatedAt === 'number'
    case 'roster/heartbeat':
      return true
    default:
      return false
  }
}

/** Pull queue so a subscriber that stops reading buffers instead of dropping frames. */
class RosterQueue {
  private readonly values: RosterFrame[] = []
  private readonly waiters: (() => void)[] = []
  private done = false

  push(value: RosterFrame): void {
    if (this.done) return
    this.values.push(value)
    this.wake()
  }

  end(): void {
    this.done = true
    this.wake()
  }

  async next(): Promise<IteratorResult<RosterFrame>> {
    for (;;) {
      if (this.values.length > 0) return { done: false, value: this.values.shift() as RosterFrame }
      if (this.done) return { done: true, value: undefined }
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter()
  }
}

/**
 * Serve one roster generation.
 *
 * Listener attachment precedes the snapshot, so a change that lands while the
 * listing runs is queued and applied after it instead of being lost.
 * @param source - local list plus live local edges.
 * @param signal - stream cancellation.
 * @returns the snapshot, then every later local change.
 */
export async function* rosterStream(source: RosterSource, signal: AbortSignal): AsyncIterable<RosterFrame> {
  const queue = new RosterQueue()
  const dispose = source.subscribe((frame) => {
    queue.push(frame)
  })
  const stop = (): void => {
    queue.end()
  }
  signal.addEventListener('abort', stop, { once: true })
  const heartbeat = setInterval(() => {
    queue.push({ type: 'roster/heartbeat' })
  }, ROSTER_HEARTBEAT_MS)
  heartbeat.unref?.()
  try {
    const snapshot = await source.list()
    if (signal.aborted) return
    yield { type: 'roster/snapshot', items: snapshot.items }
    for (;;) {
      const next = await queue.next()
      if (next.done) return
      yield next.value
    }
  } finally {
    clearInterval(heartbeat)
    signal.removeEventListener('abort', stop)
    dispose()
    queue.end()
  }
}
