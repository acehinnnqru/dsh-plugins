/**
 * Whether the Session page was reached from the board.
 *
 * The marker is deliberately not persisted: it only lives for the navigation that set it. The board
 * clears it when it becomes visible, and any global panel selection clears it, so a later Session
 * opened from the sidebar does not inherit a stale return button.
 * @module dsh-plugin-session-manager/client/back-to-board
 */

/** Whether the Session header should offer the return control. */
let armed = false

/** Mounted header subscriptions. */
const listeners = new Set<() => void>()

/** Notify the mounted header action. */
function publish(): void {
  for (const listener of listeners) listener()
}

/** Arm the return control for the Session page just opened from the board. */
export function armBackToBoard(): void {
  if (armed) return
  armed = true
  publish()
}

/** Drop the return control, for example after it was used or the board became visible. */
export function disarmBackToBoard(): void {
  if (!armed) return
  armed = false
  publish()
}

/**
 * Read the current marker.
 * @returns whether the return control should render.
 */
export function backToBoardArmed(): boolean {
  return armed
}

/**
 * Observe marker changes.
 * @param listener - called after the marker changes.
 * @returns unsubscribe.
 */
export function subscribeBackToBoard(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
