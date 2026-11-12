/**
 * Browser-local pinned Session set.
 *
 * Pins are a view preference, not host state: they live in `localStorage` and survive a panel round
 * trip and a reload. The module keeps the set in memory as well, so an unavailable storage area only
 * costs persistence, never the feature.
 * @module dsh-plugin-session-manager/client/pins
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Versioned key; a future shape can migrate without reading the old array. */
const STORAGE_KEY = 'dsh.session-manager.pinned.v1'

/** Pinned ids in pin order. */
const pinned = new Set<SessionId>()

/** Mounted-board subscriptions. */
const listeners = new Set<() => void>()

/** Whether the stored array has been read. */
let loaded = false

/** Load the stored array once; a missing or corrupt entry just means no pins. */
function load(): void {
  if (loaded) return
  loaded = true
  try {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    for (const value of parsed) {
      if (typeof value === 'string' && value !== '') pinned.add(value as SessionId)
    }
  } catch {
    // A corrupt entry or blocked storage leaves the in-memory set empty.
  }
}

/** Write the current order; a failed write leaves the in-memory pins usable. */
function persist(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...pinned]))
  } catch {
    // Quota or privacy mode: the pins still work for this page.
  }
}

/** Notify every mounted board that the pin set changed. */
function publish(): void {
  for (const listener of listeners) listener()
}

/**
 * Read the pinned ids in pin order.
 * @returns a copy, so a render cannot mutate the store.
 */
export function pinnedSessionIds(): SessionId[] {
  load()
  return [...pinned]
}

/**
 * Pin or unpin one Session.
 * @param sessionId - Session to toggle; a new pin goes to the end of the order.
 */
export function togglePin(sessionId: SessionId): void {
  load()
  if (!pinned.delete(sessionId)) pinned.add(sessionId)
  persist()
  publish()
}

/**
 * Observe pin changes.
 * @param listener - called after a toggle.
 * @returns unsubscribe.
 */
export function subscribePins(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
