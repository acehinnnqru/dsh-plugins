/**
 * Full-list title search behind the board's search dialog.
 *
 * The board only shows Sessions that are running, unread, or inside the Recent window; the dialog
 * searches the whole listed set so an older Session stays reachable without widening that window.
 * Matching is a case-insensitive substring test on the card title — the host-facing label, which is
 * the durable title when the Host projected one.
 *
 * The derivation lives here, apart from React, so it can be tested like `board.ts`.
 * @module dsh-plugin-session-manager/client/session-search
 */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  newestFirst,
  sessionState,
  type PinnedState,
  type SessionCard,
} from './board.ts'

/** One search result: a card plus the runtime state its preview opens with. */
export interface SessionHit extends SessionCard {
  readonly state: PinnedState
}

/**
 * Build the searchable set from the whole Session list.
 *
 * Eligibility is the board's rule — ordinary, listed, non-blank, non-subagent, non-archived — but
 * there is no Recent-window cutoff, so every listed Session is reachable. Order is the board's
 * newest-first order, which is the useful default for an empty query.
 * @param list - Session Controller list snapshot.
 * @param statuses - unified UI status by Session.
 * @param archivedSessionIds - registry-global archive set.
 * @param readAt - completion read marks, keyed by Session, valued by the summary `updatedAt` read.
 * @param locallyCompleted - stops the board observed itself and has not acknowledged.
 * @returns every searchable Session, newest first, with its runtime state.
 */
export function searchableSessions(
  list: SessionListState,
  statuses: SessionStatusSnapshot,
  archivedSessionIds: readonly SessionId[],
  readAt: ReadonlyMap<SessionId, number> = new Map(),
  locallyCompleted: ReadonlySet<SessionId> = new Set(),
): SessionHit[] {
  const archived = new Set(archivedSessionIds)
  const hits: SessionHit[] = []

  for (const id of list.ids) {
    const row = list.byId[id]
    if (row === undefined || row.blank || row.origin === 'subagent' || archived.has(id)) continue

    const status = statuses.get(id)
    hits.push({
      id,
      title: row.displayTitle,
      cwd: row.cwd,
      updatedAt: row.updatedAt,
      waitingKind: status?.pendingInteraction?.kind,
      state: sessionState(
        status,
        status?.running ?? row.running,
        (readAt.get(id) ?? Number.NEGATIVE_INFINITY) >= row.updatedAt,
        locallyCompleted.has(id),
      ),
    })
  }

  return newestFirst(hits)
}

/**
 * Filter search results by a free-text title query.
 *
 * Surrounding whitespace is ignored, so a trailing space from typing does not empty the list. An
 * empty query keeps the full newest-first set, which is what the dialog shows when it opens.
 * @param hits - every searchable Session, newest first.
 * @param query - raw search text.
 * @returns the matching results, in the order they were given.
 */
export function matchSessionTitles(
  hits: readonly SessionHit[],
  query: string,
): readonly SessionHit[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return hits
  return hits.filter((hit) => hit.title.toLowerCase().includes(needle))
}
