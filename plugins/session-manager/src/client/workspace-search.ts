/**
 * Presentation helpers for the searchable Workspace picker.
 *
 * The native hero's Workspace chip lists Workspaces without a filter; the overlay's picker keeps the
 * same naming rule but needs a label and a case-insensitive filter that can be tested without React.
 * The naming rule lives here rather than with the renderers because the board's Session search
 * matches a row by the Workspace it lives in, and that module must stay React-free.
 * @module dsh-plugin-session-manager/client/workspace-search
 */

import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionCard } from './board.ts'

/** The product's automatic title for the directory-backed default Workspace. */
export const DEFAULT_WORKSPACE_TITLE = 'default-workspace'

/**
 * Basename of a POSIX or Windows working directory.
 * @param path - absolute directory path.
 * @returns the final path segment, without trailing separators.
 */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (trimmed === '') return path
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return at === -1 ? trimmed : trimmed.slice(at + 1)
}

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
  return title !== '' ? title : baseName(workspace.path)
}

/**
 * Resolve the Workspace a Session belongs to.
 *
 * Membership wins; a cwd match covers a row whose Workspace set is still catching up.
 * @param card - Session card.
 * @param items - Workspace rows.
 * @returns the owning Workspace, or undefined for a Session outside every Workspace.
 */
export function workspaceOf(
  card: SessionCard,
  items: readonly WorkspaceView[],
): WorkspaceView | undefined {
  return items.find((item) => item.sessionIds.includes(card.id))
    ?? items.find((item) => card.cwd !== undefined && item.path === card.cwd)
}

/**
 * Compress a Workspace directory into a short parent-path hint.
 *
 * The row already shows the Workspace name, so the path is only there to place it. A home-relative
 * path is abbreviated per parent segment (for example `~/r/g/a/` for
 * `/Users/me/r/github.com/acme/project`) and keeps a trailing separator. The full path stays
 * available as the row's tooltip.
 * @param path - canonical Workspace directory.
 * @returns the abbreviated parent path, or an empty string when there is no parent to show.
 */
export function compactDirectory(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (trimmed === '') return ''
  const parts = trimmed.split(/[\\/]+/).filter((part) => part !== '')
  if (parts.length <= 1) return ''

  const windowsHome = parts.length > 2
    && /^[A-Za-z]:$/.test(parts[0] ?? '')
    && (parts[1] === 'Users' || parts[1] === 'home')
  const posixHome = parts[0] === 'Users' || parts[0] === 'home'
  const home = windowsHome || posixHome
  const root = parts.slice(windowsHome ? 3 : posixHome ? 2 : 0)
  const parent = root.slice(0, -1)
  const prefix = home ? '~' : ''
  if (parent.length === 0) return `${prefix}/`
  return `${prefix}/${parent.map((part) => Array.from(part)[0] ?? '').join('/')}/`
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
