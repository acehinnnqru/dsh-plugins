import { describe, expect, it } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { currentWorkspaceId, recentWorkspaceId } from '../src/client/new-conversation-target.ts'

/**
 * Target selection for the new-conversation overlay.
 *
 * The module is pure, so the tests build the two snapshots the board already reads: the Session list
 * and the Workspace registry. They cover the native order the board copies — the current main
 * Session's Workspace, then the Workspace with the most recent activity.
 */

/** One Session row the helpers care about. */
interface Row {
  readonly id: string
  readonly updatedAt: number
  readonly blank: boolean
  readonly mainView?: number
}

/**
 * Build a Session list snapshot from the rows the helpers read.
 * @param rows - Session id, activity instant, and blank flag.
 * @returns a list snapshot.
 */
function list(rows: readonly Row[]): SessionListState {
  return {
    ids: rows.map((row) => row.id),
    byId: Object.fromEntries(rows.map((row) => [row.id, {
      id: row.id,
      displayTitle: row.id,
      cwd: `/work/${row.id}`,
      updatedAt: row.updatedAt,
      blank: row.blank,
      origin: 'user',
      running: false,
      retainedBy: { mainView: row.mainView ?? 0 },
    }])),
    phase: 'ready',
    projectionsBySession: {},
  } as unknown as SessionListState
}

/**
 * Build a Workspace registry snapshot.
 * @param items - Workspace id, members, and creation instant.
 * @param archived - archived Session ids.
 * @returns a Workspace snapshot.
 */
function workspaces(
  items: readonly { readonly id: string; readonly sessionIds: readonly string[]; readonly createdAt: string }[],
  archived: readonly string[] = [],
): WorkspaceSnapshot {
  return {
    items: items.map((item) => ({
      workspaceId: item.id,
      path: `/work/${item.id}`,
      title: item.id,
      sessionIds: item.sessionIds,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
    })),
    archivedSessionIds: archived,
    pinnedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  } as unknown as WorkspaceSnapshot
}

const OLD = new Date(1_000).toISOString()

describe('recentWorkspaceId', () => {
  it('targets the Workspace whose newest Session moved last', () => {
    const registry = workspaces([
      { id: 'alpha', sessionIds: ['a1'], createdAt: OLD },
      { id: 'beta', sessionIds: ['b1'], createdAt: OLD },
    ])
    const sessions = list([
      { id: 'a1', updatedAt: 100, blank: false },
      { id: 'b1', updatedAt: 200, blank: false },
    ])

    expect(recentWorkspaceId(registry, sessions)).toBe('beta')
  })

  it('falls back to creation time for a Workspace without listed Sessions', () => {
    const registry = workspaces([
      { id: 'alpha', sessionIds: ['a1'], createdAt: OLD },
      { id: 'beta', sessionIds: [], createdAt: new Date(5_000).toISOString() },
    ])
    const sessions = list([{ id: 'a1', updatedAt: 100, blank: false }])

    expect(recentWorkspaceId(registry, sessions)).toBe('beta')
  })

  it('returns nothing before the registry has a row', () => {
    expect(recentWorkspaceId(workspaces([]), list([]))).toBeUndefined()
  })
})

describe('currentWorkspaceId', () => {
  it('prefers the Workspace of the session retained as the main view', () => {
    const registry = workspaces([
      { id: 'alpha', sessionIds: ['a1'], createdAt: OLD },
      { id: 'beta', sessionIds: ['b1'], createdAt: OLD },
    ])
    const sessions = list([
      { id: 'a1', updatedAt: 300, blank: false },
      { id: 'b1', updatedAt: 100, blank: false, mainView: 1 },
    ])

    expect(currentWorkspaceId(registry, sessions)).toBe('beta')
  })

  it('uses the first retained row in the list map', () => {
    const registry = workspaces([
      { id: 'alpha', sessionIds: ['a1'], createdAt: OLD },
      { id: 'beta', sessionIds: ['b1'], createdAt: OLD },
    ])
    const sessions = list([
      { id: 'b1', updatedAt: 100, blank: false, mainView: 1 },
      { id: 'a1', updatedAt: 200, blank: false, mainView: 1 },
    ])

    expect(currentWorkspaceId(registry, sessions)).toBe('beta')
  })

  it('returns nothing without a retained main Session', () => {
    const registry = workspaces([{ id: 'alpha', sessionIds: ['a1'], createdAt: OLD }])
    const sessions = list([{ id: 'a1', updatedAt: 100, blank: false }])

    expect(currentWorkspaceId(registry, sessions)).toBeUndefined()
  })

  it('returns nothing when the main Session belongs to no Workspace', () => {
    const registry = workspaces([{ id: 'alpha', sessionIds: ['a1'], createdAt: OLD }])
    const sessions = list([{ id: 'orphan', updatedAt: 100, blank: false, mainView: 1 }])

    expect(currentWorkspaceId(registry, sessions)).toBeUndefined()
  })
})
