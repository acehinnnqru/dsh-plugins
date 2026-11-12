import { describe, expect, it } from 'vitest'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  DEFAULT_WORKSPACE_TITLE,
  matchWorkspaces,
  workspaceLabel,
} from '../src/client/workspace-search.ts'

/**
 * The searchable Workspace picker's pure half.
 *
 * The component owns the dialog and the keyboard; these tests cover the label rule and the filter
 * the picker feeds with its search field.
 */

/**
 * Build one Workspace row.
 * @param workspaceId - registry id.
 * @param title - stored title.
 * @param path - canonical directory.
 * @returns a complete Workspace view.
 */
function workspace(workspaceId: string, title: string, path: string): WorkspaceView {
  return {
    workspaceId,
    title,
    path,
    sessionIds: [],
    createdAt: new Date(1_000).toISOString(),
    updatedAt: new Date(1_000).toISOString(),
  } as unknown as WorkspaceView
}

const ALPHA = workspace('alpha', 'Alpha', '/work/alpha')
const BETA = workspace('beta', 'Beta project', '/home/me/beta')
const UNTITLED = workspace('untitled', '', '/work/untitled/')
const DEFAULT = workspace('default', DEFAULT_WORKSPACE_TITLE, '/work/default')

describe('workspaceLabel', () => {
  it('uses a stored title', () => {
    expect(workspaceLabel(ALPHA)).toBe('Alpha')
  })

  it('falls back to the final path segment without a trailing separator', () => {
    expect(workspaceLabel(UNTITLED)).toBe('untitled')
  })

  it('hands the default marker through for the caller to localize', () => {
    expect(workspaceLabel(DEFAULT)).toBe(DEFAULT_WORKSPACE_TITLE)
  })
})

describe('matchWorkspaces', () => {
  const all = [ALPHA, BETA, UNTITLED, DEFAULT]

  it('keeps registry order for an empty query', () => {
    expect(matchWorkspaces(all, '   ')).toEqual(all)
  })

  it('matches a title case-insensitively', () => {
    expect(matchWorkspaces(all, 'PROJECT')).toEqual([BETA])
  })

  it('matches the path as well as the title', () => {
    expect(matchWorkspaces(all, '/home/me')).toEqual([BETA])
  })

  it('returns nothing when neither field matches', () => {
    expect(matchWorkspaces(all, 'missing')).toEqual([])
  })
})
