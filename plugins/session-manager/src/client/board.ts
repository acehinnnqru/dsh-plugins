/**
 * Pure derivation for the session board.
 *
 * The board is a kanban over three useful states: a turn is running, something is unread (a pending
 * interaction or an unacknowledged completion), or the Session is recent but already read. Recent
 * keeps a Session findable after it leaves Unread; blank drafts, archived rows, and subagent-origin
 * rows still have no column.
 *
 * Keeping the derivation here, apart from React and the slot props, is what lets the classification
 * be tested without a browser.
 * @module dsh-plugin-session-manager/client/board
 */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The three board columns, in order. */
export const BOARD_COLUMNS = ['running', 'unread', 'recent'] as const

/** One board column. */
export type BoardColumn = (typeof BOARD_COLUMNS)[number]

/** One Session card. */
export interface SessionCard {
  /** Session the card opens. */
  readonly id: SessionId
  /** Host-facing label: durable title, project basename, or the Session id. */
  readonly title: string
  /** Session working directory, when the Host reports one. */
  readonly cwd: string | undefined
  /** Latest durable activity, used to order cards newest first. */
  readonly updatedAt: number
  /** Domain kind of the pending interaction; only waiting cards carry one. */
  readonly waitingKind: string | undefined
}

/** A card's label state: pending interaction, running, unread completion, or idle. */
export type PinnedState = 'waiting' | 'running' | 'completed' | 'idle'

/** Recent-window choices, in days. */
export const RECENT_WINDOW_DAYS = [1, 3, 7, 30] as const

/** One allowed Recent window length. */
export type RecentWindowDays = (typeof RECENT_WINDOW_DAYS)[number]

/** Default Recent window: three days. */
export const DEFAULT_RECENT_WINDOW_DAYS: RecentWindowDays = 3

/** One pinned card and the state its label uses. */
export interface PinnedCard extends SessionCard {
  readonly state: PinnedState
}

/** The derived board: one newest-first card list per column. */
export interface SessionBoard {
  /** Sessions with a running turn and no pending interaction. */
  readonly running: readonly SessionCard[]
  /** Pending interactions and completions that have not been acknowledged. */
  readonly unread: readonly SessionCard[]
  /** Read and idle Sessions, kept newest first so they remain findable. */
  readonly recent: readonly SessionCard[]
}

/** Copy keys that name a pending interaction. */
export type WaitingCopyKey = 'waiting.approval' | 'waiting.planReview' | 'waiting.question' | 'waiting.input'

/**
 * Map a runtime interaction kind to the card's copy key.
 *
 * The Web client's row presentation names three shipped domains; any future or plugin-contributed
 * domain still lands in **Unread**, just under the generic label.
 * @param kind - `pendingInteraction.kind`, or undefined when there is no interaction.
 * @returns the locale key naming why the Session waits.
 */
export function waitingCopyKey(kind: string | undefined): WaitingCopyKey {
  switch (kind) {
    case 'approval': return 'waiting.approval'
    case 'plan-review': return 'waiting.planReview'
    case 'question': return 'waiting.question'
    default: return 'waiting.input'
  }
}

/**
 * Keep recent cards inside the configured window.
 * @param cards - cards from the Recent column.
 * @param now - current epoch ms.
 * @param days - window length in days.
 * @returns cards whose latest activity is inside the inclusive window.
 */
export function withinRecent(
  cards: readonly SessionCard[],
  now: number,
  days: RecentWindowDays,
): readonly SessionCard[] {
  const since = now - days * 86_400_000
  return cards.filter((card) => card.updatedAt >= since)
}

/**
 * Order one column newest first, with the Session id as a stable tie-break.
 * @param cards - cards collected for one column.
 * @returns the same cards in render order.
 */
function newestFirst(cards: SessionCard[]): SessionCard[] {
  return cards.sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
}

/**
 * Derive the three columns from the live Session list, status snapshot, archive set, and marks.
 *
 * A row is considered only when it is a non-blank ordinary Session that is still listed and not
 * archived. Its status then decides the column, in precedence order: a pending interaction outranks
 * a running turn (the same rule the Session row uses); a running turn outranks an unread completion;
 * and an unread completion that has not been acknowledged goes to **Unread**. Everything left is
 * **Recent**, so a Session stays visible after it is read. Before the status snapshot knows a row,
 * its list-run flag is the fallback — exactly the one the Workspace row uses.
 * @param list - Session Controller list snapshot.
 * @param statuses - unified UI status by Session.
 * @param archivedSessionIds - registry-global archive set.
 * @param locallyCompleted - Sessions the board watched stop while it was mounted. DSH leaves
 *   `completionUnread` false when the Session is still retained as `mainView` behind a global
 *   panel, so the board keeps its own stop observation.
 * @param readAt - completion read marks, keyed by Session, valued by the summary `updatedAt` shown.
 *   A mark at least as new as the row moves an unread completion to Recent.
 * @returns the board, one newest-first list per column.
 */
export function deriveBoard(
  list: SessionListState,
  statuses: SessionStatusSnapshot,
  archivedSessionIds: readonly SessionId[],
  locallyCompleted: ReadonlySet<SessionId> = new Set(),
  readAt: ReadonlyMap<SessionId, number> = new Map(),
): SessionBoard {
  const archived = new Set(archivedSessionIds)
  const running: SessionCard[] = []
  const unread: SessionCard[] = []
  const recent: SessionCard[] = []

  for (const id of list.ids) {
    const row = list.byId[id]
    if (row === undefined || row.blank || row.origin === 'subagent' || archived.has(id)) continue

    const status = statuses.get(id)
    const pendingInteraction = status?.pendingInteraction
    const isRunning = status?.running ?? row.running
    const completionUnread = status?.completionUnread === true
    const locallyDone = locallyCompleted.has(id)
    const read = (readAt.get(id) ?? Number.NEGATIVE_INFINITY) >= row.updatedAt

    const card: SessionCard = {
      id,
      title: row.displayTitle,
      cwd: row.cwd,
      updatedAt: row.updatedAt,
      waitingKind: pendingInteraction?.kind,
    }

    if (pendingInteraction !== undefined) unread.push(card)
    else if (isRunning) running.push(card)
    else if (locallyDone || (completionUnread && !read)) unread.push(card)
    else recent.push(card)
  }

  return {
    running: newestFirst(running),
    unread: newestFirst(unread),
    recent: newestFirst(recent),
  }
}

/**
 * Build cards for pinned Sessions, in pin order.
 *
 * A pinned Session stays at the top even when it is idle or already read, so this reads the whole
 * listed set rather than one column. Archived, blank, and subagent rows are skipped. A completion
 * still counts after the Session was opened from the board only when it is in `locallyCompleted`;
 * otherwise an up-to-date read mark turns the label to idle.
 * @param list - Session Controller list snapshot.
 * @param statuses - unified UI status by Session.
 * @param archivedSessionIds - registry-global archive set.
 * @param pinnedSessionIds - pinned Session ids, in the order the user pinned them.
 * @param readAt - completion read marks, keyed by Session, valued by the summary `updatedAt` shown.
 * @param locallyCompleted - stops the board observed itself and has not acknowledged.
 * @returns pinned cards in pin order.
 */
export function derivePinned(
  list: SessionListState,
  statuses: SessionStatusSnapshot,
  archivedSessionIds: readonly SessionId[],
  pinnedSessionIds: readonly SessionId[],
  readAt: ReadonlyMap<SessionId, number> = new Map(),
  locallyCompleted: ReadonlySet<SessionId> = new Set(),
): PinnedCard[] {
  const archived = new Set(archivedSessionIds)
  const seen = new Set<SessionId>()
  const cards: PinnedCard[] = []

  for (const id of pinnedSessionIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const row = list.byId[id]
    if (row === undefined || row.blank || row.origin === 'subagent' || archived.has(id)) continue

    const status = statuses.get(id)
    const pendingInteraction = status?.pendingInteraction
    const isRunning = status?.running ?? row.running
    const completionUnread = status?.completionUnread === true
    const locallyDone = locallyCompleted.has(id)
    const read = (readAt.get(id) ?? Number.NEGATIVE_INFINITY) >= row.updatedAt

    const state: PinnedState = pendingInteraction !== undefined
      ? 'waiting'
      : isRunning
        ? 'running'
        : (completionUnread || locallyDone) && (locallyDone || !read)
          ? 'completed'
          : 'idle'

    const card: PinnedCard = {
      id,
      title: row.displayTitle,
      cwd: row.cwd,
      updatedAt: row.updatedAt,
      waitingKind: pendingInteraction?.kind,
      state,
    }
    cards.push(card)
  }

  return cards
}
