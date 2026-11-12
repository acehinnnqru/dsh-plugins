/**
 * Target selection for the board's new-conversation overlay.
 *
 * The board is a global panel, so it has no selected Session whose Workspace could be the target. It
 * follows the rule the native New Session action uses when nothing is selected: the Workspace with
 * the most recent Session activity. A blank Session already parked there is reused, exactly as the
 * Host reuses the first reusable blank member instead of creating another one.
 * @module dsh-plugin-session-manager/client/new-conversation-target
 */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Pick the Workspace whose Sessions moved most recently.
 *
 * A Workspace with no listed Session falls back to its own creation instant, so an empty project can
 * still become the target. Ties keep the first Workspace in registry order.
 * @param workspaces - Workspace registry snapshot.
 * @param list - Session list snapshot.
 * @returns the target Workspace, or undefined before the registry has any row.
 */
export function recentWorkspaceId(
  workspaces: WorkspaceSnapshot,
  list: SessionListState,
): WorkspaceId | undefined {
  let selected: WorkspaceId | undefined
  let selectedAt = Number.NEGATIVE_INFINITY

  for (const workspace of workspaces.items) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const row = list.byId[sessionId]
      if (row !== undefined) latest = Math.max(latest, row.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) {
      const created = Date.parse(workspace.createdAt)
      latest = Number.isNaN(created) ? Number.NEGATIVE_INFINITY : created
    }
    if (selected === undefined || latest > selectedAt) {
      selected = workspace.workspaceId
      selectedAt = latest
    }
  }

  return selected
}

/**
 * Find the blank Session the Host may reuse for a new conversation in one Workspace.
 *
 * The reuse predicate mirrors the Host's: an unarchived member of the requested Workspace. The
 * newest blank wins, so a draft parked by an earlier visit is the one that comes back.
 * @param workspaces - Workspace registry snapshot, including the archive set.
 * @param list - Session list snapshot.
 * @param workspaceId - target Workspace, or undefined when there is none.
 * @returns the reusable blank Session, or undefined when the Workspace has none.
 */
export function reusableBlankSession(
  workspaces: WorkspaceSnapshot,
  list: SessionListState,
  workspaceId: WorkspaceId | undefined,
): SessionId | undefined {
  if (workspaceId === undefined) return undefined
  const workspace = workspaces.items.find((item) => item.workspaceId === workspaceId)
  if (workspace === undefined) return undefined

  const archived = new Set(workspaces.archivedSessionIds)
  let selected: SessionId | undefined
  let selectedAt = Number.NEGATIVE_INFINITY

  for (const sessionId of workspace.sessionIds) {
    const row = list.byId[sessionId]
    if (row === undefined || !row.blank || archived.has(sessionId)) continue
    if (selected === undefined || row.updatedAt > selectedAt) {
      selected = sessionId
      selectedAt = row.updatedAt
    }
  }

  return selected
}
