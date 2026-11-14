/**
 * Pins for remote Sessions, kept by the viewing browser.
 *
 * The Host workspace registry only accepts Session ids it owns, so a remote
 * Session is pinned here instead. The order is most recently pinned first.
 * @module dsh-plugin-session-manager/client/remote-pins
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Local-storage key holding the remote pin order. */
export const REMOTE_PIN_KEY = 'dsh-session-manager:remote-pins'

/** The two storage calls this module needs. */
export type PinStorage = Pick<Storage, 'getItem' | 'setItem'>

/** Resolve the browser store, or undefined when storage is unavailable. */
function browserStorage(): PinStorage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/** Read the stored remote pin order. */
export function readRemotePins(storage: PinStorage | undefined = browserStorage()): SessionId[] {
  if (storage === undefined) return []
  try {
    const raw = storage.getItem(REMOTE_PIN_KEY)
    if (raw === null) return []
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    const seen = new Set<string>()
    const ids: SessionId[] = []
    for (const item of value) {
      if (typeof item !== 'string' || item.length === 0 || seen.has(item)) continue
      seen.add(item)
      ids.push(item as SessionId)
    }
    return ids
  } catch {
    return []
  }
}

/** Persist the remote pin order. */
export function writeRemotePins(ids: readonly SessionId[], storage: PinStorage | undefined = browserStorage()): void {
  if (storage === undefined) return
  try {
    storage.setItem(REMOTE_PIN_KEY, JSON.stringify(ids))
  } catch {
    // A browser that refuses storage still keeps the current page state.
  }
}

/** Pin or unpin one remote Session, returning the new order. */
export function toggleRemotePin(ids: readonly SessionId[], sessionId: SessionId, pinned: boolean): SessionId[] {
  const rest = ids.filter((id) => id !== sessionId)
  return pinned ? rest : [sessionId, ...rest]
}
