/**
 * Board-local completion tracking.
 *
 * DSH's `completionUnread` is precise about the conversation it considers main, but a global panel
 * keeps the last conversation `mainView`-retained behind it. That makes a stop look read while the
 * board is the visible surface. This tracker observes the running→stopped edge globally and records
 * it, unless the stopping Session's conversation is actually on screen.
 *
 * The same rule settles a shared read: the Host marks every stop unread, including one the reader
 * watched, and only an open conversation can say that it was read.
 * @module dsh-plugin-session-manager/client/completion-tracker
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionListState, SessionReferenceSource } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: they carry the declarations for ctx.uiSession and ctx.layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/** Stops the tracker observed while the Session's conversation was off screen. */
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
 * Whether a Session's conversation is on screen right now.
 *
 * Two surfaces show one: the native page, which retains the Session as `mainView` while no global
 * panel is selected, and the board's new-conversation overlay, which retains it as `sessionManager`
 * for as long as its embedded conversation is mounted. The overlay is interactive, so a stop there
 * is a stop the reader watched.
 * @param retainedBy - retention counts from the listed Session row.
 * @param activePanelId - the selected global panel, or null when a Session page is showing.
 * @returns true when a stop is already being watched.
 */
function conversationShown(
  retainedBy: Readonly<Partial<Record<SessionReferenceSource, number>>>,
  activePanelId: string | null,
): boolean {
  if ((retainedBy.sessionManager ?? 0) > 0) return true
  return activePanelId === null && (retainedBy.mainView ?? 0) > 0
}

/** The live facts one visible-read acknowledgement needs. */
export interface VisibleReadSource {
  /** Session Controller list snapshot. */
  readonly list: SessionListState
  /** The selected global panel, or null when a Session page is showing. */
  readonly activePanelId: string | null
  /** Whether the shared status row still counts one completion unread. */
  readonly unread: (sessionId: SessionId) => boolean
  /** Acknowledge one Session read on the Host. */
  readonly read: (sessionId: SessionId) => void
}

/**
 * Acknowledge every shared unread completion whose conversation is on screen.
 *
 * The owner marks a running→stopped edge unread without knowing what the browser shows, and DSH
 * sets no marker of its own for a stop the reader watched live, so no native transition clears the
 * shared row. A conversation that is open has been read: this is the read side of the same on-screen
 * rule the tracker applies to its stop notes.
 * @param source - the listed rows, the selected panel, the shared unread lookup, and the read call.
 */
export function acknowledgeVisibleUnread(source: VisibleReadSource): void {
  for (const id of source.list.ids) {
    const row = source.list.byId[id]
    if (row === undefined || !conversationShown(row.retainedBy, source.activePanelId)) continue
    if (source.unread(id)) source.read(id)
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
 * A stop is recorded only when the Session's conversation is off screen, in neither the native page
 * nor the new-conversation overlay. Opening that conversation later clears the local mark, so the
 * board does not resurrect a completion the user has since read.
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
      const visible = conversationShown(row.retainedBy, activePanelId)

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

  /** A Session that comes on screen has been read; drop its local mark. */
  const clearVisible = (): void => {
    const { activePanelId } = ctx.layout.panelInfo.getSnapshot()
    const list = ctx.sessions.list.getSnapshot()
    let changed = false
    for (const id of list.ids) {
      const row = list.byId[id]
      if (row === undefined || !conversationShown(row.retainedBy, activePanelId)) continue
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
