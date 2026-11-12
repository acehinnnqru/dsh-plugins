/**
 * Board-local completion tracking.
 *
 * DSH's `completionUnread` is precise about the conversation it considers main, but a global panel
 * keeps the last conversation `mainView`-retained behind it. That makes a stop look read while the
 * board is the visible surface. This tracker observes the running→stopped edge globally and records
 * it, unless the stopping Session is actually the visible conversation.
 * @module dsh-plugin-session-manager/client/completion-tracker
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: they carry the declarations for ctx.uiSession and ctx.layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/** Stops the tracker observed while the Session was not the visible conversation. */
const localCompleted = new Set<SessionId>()

/** Page subscriptions, so a recorded stop can re-render an already mounted board. */
const listeners = new Set<() => void>()

/** Notify every subscribed page that the local completion map changed. */
function publish(): void {
  for (const listener of listeners) listener()
}

/**
 * Observe local completion changes.
 * @param listener - called after a stop is recorded, cleared, or invalidated.
 * @returns unsubscribe.
 */
export function subscribeLocalCompletions(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Clear one local completion, for example after its card was opened.
 * @param sessionId - Session whose mark should go.
 */
export function clearLocalCompletion(sessionId: SessionId): void {
  if (localCompleted.delete(sessionId)) publish()
}

/**
 * The local completions that still have a listed Session.
 * @param list - Session Controller list snapshot.
 * @returns Session ids the board should treat as completed.
 */
export function localCompletionIds(list: SessionListState): Set<SessionId> {
  const ids = new Set<SessionId>()
  for (const id of localCompleted) {
    if (list.byId[id] !== undefined) ids.add(id)
  }
  return ids
}

/**
 * Start the global running→stopped tracker.
 *
 * A stop is recorded only when the Session is not the visible conversation: the conversation is
 * selected (`activePanelId === null`) and the Session is the one retained as `mainView`. Opening
 * that conversation later clears the local mark, so the board does not resurrect a completion the
 * user has since read.
 * @param ctx - client context carrying sessions, the Session UI status, and layout.
 */
export function startCompletionTracker(ctx: ClientContext): void {
  let previous = new Map<SessionId, boolean>()

  const reconcile = (): void => {
    const statuses = ctx.uiSession.sessionStatus.getSnapshot()
    const list = ctx.sessions.list.getSnapshot()
    const { activePanelId } = ctx.layout.panelInfo.getSnapshot()
    const next = new Map<SessionId, boolean>()
    let changed = false

    for (const id of list.ids) {
      const row = list.byId[id]
      if (row === undefined || row.blank || row.origin === 'subagent') continue
      const running = statuses.get(id)?.running ?? row.running
      const was = previous.get(id)
      const visible = activePanelId === null && (row.retainedBy.mainView ?? 0) > 0

      if (was === true && !running) {
        if (visible) {
          if (localCompleted.delete(id)) changed = true
        } else if (!localCompleted.has(id)) {
          localCompleted.add(id)
          changed = true
        }
      } else if (running && localCompleted.delete(id)) {
        changed = true
      }

      next.set(id, running)
    }

    previous = next
    if (changed) publish()
  }

  /** A Session that becomes the visible conversation has been read; drop its local mark. */
  const clearVisible = (): void => {
    if (ctx.layout.panelInfo.getSnapshot().activePanelId !== null) return
    const list = ctx.sessions.list.getSnapshot()
    let changed = false
    for (const id of list.ids) {
      const row = list.byId[id]
      if (row === undefined || (row.retainedBy.mainView ?? 0) === 0) continue
      if (localCompleted.delete(id)) changed = true
    }
    if (changed) publish()
  }

  ctx.effect(() => {
    const disposeStatus = ctx.uiSession.sessionStatus.subscribe(reconcile)
    const disposePanel = ctx.layout.panelInfo.subscribe(clearVisible)
    const disposeList = ctx.sessions.list.subscribe(clearVisible)
    reconcile()
    clearVisible()
    return () => {
      disposeStatus()
      disposePanel()
      disposeList()
      previous = new Map()
    }
  }, 'session-manager: completion tracker')
}
