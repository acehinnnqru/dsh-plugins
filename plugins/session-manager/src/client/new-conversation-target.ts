/**
 * Target selection for the board's new-conversation overlay.
 *
 * The native New Session action prefers the Workspace of the Session the app currently shows,
 * falling back to the Workspace with the most recent Session activity. The Client keeps that current
 * Session retained under the `mainView` source, so the board can follow the same order without
 * reaching into navigation state. The blank Session itself is resolved by the Workspace controller,
 * which reuses the first member blank or creates one under the Host default.
 * @module dsh-plugin-session-manager/client/new-conversation-target
 */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: declares the `mainView` reference source on the Session retain counts.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/**
 * Find the Workspace of the Session the app currently shows.
 *
 * The Session Client retains the current main Session under `mainView`; the Workspace navigation
 * uses that membership as its "current Workspace" before falling back to recent activity. The first
 * retained row in the list's map order is the one the Client itself resolves when several rows carry
 * the source.
 * @param workspaces - Workspace registry snapshot.
 * @param list - Session list snapshot.
 * @returns the current Session's Workspace, or undefined when no main Session is retained.
 */
export function currentWorkspaceId(
  workspaces: WorkspaceSnapshot,
  list: SessionListState,
): WorkspaceId | undefined {
  const row = Object.values(list.byId).find((candidate) => (candidate.retainedBy.mainView ?? 0) > 0)
  if (row === undefined) return undefined
  return workspaces.items.find((workspace) => workspace.sessionIds.includes(row.id))?.workspaceId
}

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
