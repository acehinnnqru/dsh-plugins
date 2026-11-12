/**
 * Pure derivation for the session board.
 *
 * The board is a kanban over the three runtime facts the Web client already publishes per Session:
 * a turn is running, a domain is waiting for the user, or a finished turn has not been acknowledged
 * yet. Everything else — a blank draft, an archived row, an idle Session the user has already read —
 * deliberately has no column, so it never appears.
 *
 * Keeping the derivation here, apart from React and the slot props, is what lets the classification
 * be tested without a browser.
 * @module dsh-plugin-session-manager/client/board
 */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The three runtime states the board shows, in column order. */
export const BOARD_COLUMNS = ['running', 'waiting', 'completed'] as const

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

/**
 * How a card's Session opens.
 *
 * A Session waiting for the user opens the compact question dialog so the native question card is
 * on screen immediately; every other card opens the full-screen conversation preview.
 * @param column - the card's column.
 * @returns the preview surface for that column.
 */
export function previewMode(column: BoardColumn): 'dialog' | 'page' {
  return column === 'waiting' ? 'dialog' : 'page'
}

/** The derived board: one newest-first card list per column. */
export interface SessionBoard {
  /** Sessions with a running turn and no pending interaction. */
  readonly running: readonly SessionCard[]
  /** Sessions whose highest-precedence domain is waiting for the user. */
  readonly waiting: readonly SessionCard[]
  /** Sessions that finished while not in the main view and are still unread. */
  readonly completed: readonly SessionCard[]
}

/** Copy keys that name a pending interaction. */
export type WaitingCopyKey = 'waiting.approval' | 'waiting.planReview' | 'waiting.question' | 'waiting.input'

/**
 * Map a runtime interaction kind to the card's copy key.
 *
 * The Web client's row presentation names three shipped domains; any future or plugin-contributed
 * domain still lands in the waiting column, just under the generic label.
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
 * Derive the three columns from the live Session list, status snapshot, and archive set.
 *
 * A row is considered only when it is a non-blank ordinary Session that is still listed and not
 * archived. Its status then decides the column, in precedence order: a pending interaction outranks
 * a running turn (the same rule the Session row uses), and an unread completion is the last
 * fallback. Before the status snapshot knows a row, its list-run flag is the fallback — exactly the
 * one the Workspace row uses. An idle/read Session means no card.
 * @param list - Session Controller list snapshot.
 * @param statuses - unified UI status by Session.
 * @param archivedSessionIds - registry-global archive set.
 * @returns the board, one newest-first list per column.
 */
export function deriveBoard(
  list: SessionListState,
  statuses: SessionStatusSnapshot,
  archivedSessionIds: readonly SessionId[],
): SessionBoard {
  const archived = new Set(archivedSessionIds)
  const running: SessionCard[] = []
  const waiting: SessionCard[] = []
  const completed: SessionCard[] = []

  for (const id of list.ids) {
    const row = list.byId[id]
    if (row === undefined || row.blank || row.origin === 'subagent' || archived.has(id)) continue

    const status = statuses.get(id)
    const pendingInteraction = status?.pendingInteraction
    const isRunning = status?.running ?? row.running
    const completionUnread = status?.completionUnread === true

    const card: SessionCard = {
      id,
      title: row.displayTitle,
      cwd: row.cwd,
      updatedAt: row.updatedAt,
      waitingKind: pendingInteraction?.kind,
    }

    if (pendingInteraction !== undefined) waiting.push(card)
    else if (isRunning) running.push(card)
    else if (completionUnread) completed.push(card)
  }

  return {
    running: newestFirst(running),
    waiting: newestFirst(waiting),
    completed: newestFirst(completed),
  }
}

/**
 * Drop completed cards the preview has already shown.
 *
 * DSH's own `completionUnread` is only cleared when a Session is retained as `mainView`; the preview
 * deliberately is not that. The preview therefore keeps its own mark: the summary `updatedAt` it
 * showed. A card is hidden while the mark is at least as new as the card, and returns as soon as
 * newer activity makes the completion current again.
 * @param cards - the derived completed column.
 * @param readAt - preview read marks, keyed by Session, valued by the summary `updatedAt` shown.
 * @returns cards that are unmarked, or whose completion is newer than their mark.
 */
export function visibleCompleted(
  cards: readonly SessionCard[],
  readAt: ReadonlyMap<SessionId, number>,
): readonly SessionCard[] {
  return cards.filter((card) => (readAt.get(card.id) ?? Number.NEGATIVE_INFINITY) < card.updatedAt)
}
