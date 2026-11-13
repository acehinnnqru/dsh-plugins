/**
 * Full-list search behind the board's search dialog.
 *
 * The board only shows Sessions that are running, unread, or inside the Recent window; the dialog
 * searches the whole listed set so an older Session stays reachable without widening that window.
 * Matching is a case-insensitive substring test on what a row shows — the card title, which is the
 * host-facing label and the durable title when the Host projected one, and the Workspace the
 * Session lives in, named by the Workspace label or the directory basename. Searching a Workspace
 * name therefore lists every Session of that project.
 *
 * The derivation lives here, apart from React, so it can be tested like `board.ts`.
 * @module dsh-plugin-session-manager/client/session-search
 */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  newestFirst,
  sessionState,
  type PinnedState,
  type SessionCard,
} from './board.ts'
import { baseName, workspaceLabel, workspaceOf } from './workspace-search.ts'

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
 * The text one hit is matched against: its title and where it lives.
 *
 * The haystack is the card title plus where the Session lives: the label of the Workspace the
 * registry accounts it to, and its directory basename. Both are included so the product's default
 * Workspace — whose stored title is the `default-workspace` marker rather than the project name —
 * stays reachable by the project it holds. The full path is deliberately absent, so a query does not
 * match half the machine.
 * @param hit - one searchable Session.
 * @param workspaces - Workspace rows.
 * @returns the lowercased haystack for one hit.
 */
function searchText(hit: SessionHit, workspaces: readonly WorkspaceView[]): string {
  const parts = [hit.title]
  const workspace = workspaceOf(hit, workspaces)
  if (workspace !== undefined) parts.push(workspaceLabel(workspace))
  if (hit.cwd !== undefined) parts.push(baseName(hit.cwd))
  return parts.join('\n').toLowerCase()
}

/**
 * Filter search results by a free-text query over the title and the Workspace.
 *
 * Surrounding whitespace is ignored, so a trailing space from typing does not empty the list. An
 * empty query keeps the full newest-first set, which is what the dialog shows when it opens.
 * @param hits - every searchable Session, newest first.
 * @param query - raw search text.
 * @param workspaces - Workspace rows, so a query can name the Workspace a Session lives in.
 * @returns the matching results, in the order they were given.
 */
export function matchSessions(
  hits: readonly SessionHit[],
  query: string,
  workspaces: readonly WorkspaceView[] = [],
): readonly SessionHit[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return hits
  return hits.filter((hit) => searchText(hit, workspaces).includes(needle))
}
