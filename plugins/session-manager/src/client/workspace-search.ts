/**
 * Presentation helpers for the searchable Workspace picker.
 *
 * The native hero's Workspace chip lists Workspaces without a filter; the overlay's picker keeps the
 * same naming rule but needs a label and a case-insensitive filter that can be tested without React.
 * @module dsh-plugin-session-manager/client/workspace-search
 */

import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'

/** The product's automatic title for the directory-backed default Workspace. */
export const DEFAULT_WORKSPACE_TITLE = 'default-workspace'

/**
 * Resolve the display label of one Workspace.
 *
 * A stored title wins; a Workspace without one falls back to the final directory segment, matching
 * how the product names a path-only Workspace. The default Workspace's stored marker is returned
 * as-is so the caller can localize it.
 * @param workspace - Workspace title and path.
 * @returns the label to show.
 */
export function workspaceLabel(workspace: Pick<WorkspaceView, 'title' | 'path'>): string {
  const title = workspace.title.trim()
  if (title !== '') return title

  const trimmed = workspace.path.replace(/[\\/]+$/, '')
  if (trimmed === '') return workspace.path
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return at === -1 ? trimmed : trimmed.slice(at + 1)
}

/**
 * Filter Workspaces by a free-text query.
 *
 * Both the title and the absolute path match, so a user can search by project name or by where it
 * lives. An empty query keeps the registry order.
 * @param workspaces - Workspaces in registry order.
 * @param query - raw search text.
 * @returns the matching Workspaces, in registry order.
 */
export function matchWorkspaces(
  workspaces: readonly WorkspaceView[],
  query: string,
): readonly WorkspaceView[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return workspaces
  return workspaces.filter((workspace) =>
    workspace.title.toLowerCase().includes(needle)
    || workspace.path.toLowerCase().includes(needle))
}
