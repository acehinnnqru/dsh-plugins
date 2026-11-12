/**
 * Browser-local Recent window preference.
 *
 * The window is a view setting, not host state: it defaults to three days, persists in
 * `localStorage`, and only filters the **Recent** column. Running and Unread never age out.
 * @module dsh-plugin-session-manager/client/recent-window
 */

import {
  DEFAULT_RECENT_WINDOW_DAYS,
  RECENT_WINDOW_DAYS,
  type RecentWindowDays,
} from './board.ts'

/** Versioned key; a future shape can migrate without reading the old number. */
const STORAGE_KEY = 'dsh.session-manager.recent-window.v1'

/** Current choice, defaulted until storage is read. */
let current: RecentWindowDays = DEFAULT_RECENT_WINDOW_DAYS

/** Whether the stored value has been read. */
let loaded = false

/** Subscribed board. */
const listeners = new Set<() => void>()

/**
 * Validate a stored or selected value.
 * @param value - candidate.
 * @returns whether it is one of the offered windows.
 */
function isWindowDays(value: unknown): value is RecentWindowDays {
  return typeof value === 'number' && (RECENT_WINDOW_DAYS as readonly number[]).includes(value)
}

/** Load the stored window once; invalid or unavailable storage keeps the default. */
function load(): void {
  if (loaded) return
  loaded = true
  try {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return
    const parsed: unknown = JSON.parse(raw)
    if (isWindowDays(parsed)) current = parsed
  } catch {
    // A corrupt entry or blocked storage keeps the default.
  }
}

/** Persist the current choice; a failed write leaves the in-memory value usable. */
function persist(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // Quota or privacy mode: the choice still applies for this page.
  }
}

/** Notify a mounted board. */
function publish(): void {
  for (const listener of listeners) listener()
}

/**
 * Read the current Recent window.
 * @returns one of {@link RECENT_WINDOW_DAYS}.
 */
export function recentWindowDays(): RecentWindowDays {
  load()
  return current
}

/**
 * Select a Recent window.
 * @param days - candidate; unknown values are ignored.
 */
export function setRecentWindowDays(days: number): void {
  load()
  if (!isWindowDays(days) || current === days) return
  current = days
  persist()
  publish()
}

/**
 * Observe window changes.
 * @param listener - called after the choice changes.
 * @returns unsubscribe.
 */
export function subscribeRecentWindow(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
