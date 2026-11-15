import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { mergeWorkspaceMembers, remoteSessionsByPath } from '../src/client/workspace-membership.ts'

/** Brand one literal Session id. */
function id(value: string): SessionId {
  return value as SessionId
}

/** One list row. */
function row(
  name: string,
  cwd: string | undefined,
  remote = false,
  blank = false,
  retained = false,
): SessionSummary {
  return {
    id: id(name),
    displayTitle: name,
    running: false,
    retainedBy: retained ? { mainView: 1 } : {},
    blank,
    updatedAt: 1,
    ...(cwd === undefined ? {} : { cwd }),
    ...(remote
      ? { projections: { kind: 'cached' as const, asOfSeq: 0, values: { sessionManagerNode: { nodeId: 'nd_b', name: 'node-b' } } } }
      : {}),
  }
}

/** One list snapshot. */
function listOf(rows: readonly SessionSummary[]): SessionListState {
  const byId: Record<SessionId, SessionSummary> = {}
  for (const item of rows) byId[item.id] = item
  return {
    ids: rows.map((item) => item.id),
    byId,
    phase: 'ready',
    projectionsBySession: {},
  }
}

describe('workspace membership overlay', () => {
  it('groups only remote rows that carry a directory', () => {
    const list = listOf([
      row('local', '/work'),
      row('remote', '/work', true),
      row('remote-no-dir', undefined, true),
      row('parked-blank', '/work', true, true),
      row('open-blank', '/work', true, true, true),
    ])
    for (const name of ['remote', 'remote-no-dir', 'parked-blank', 'open-blank']) {
      list.projectionsBySession[id(name)] = {
        values: { sessionManagerNode: { nodeId: 'nd_b', name: 'node-b' } },
        state: 'ready',
        error: null,
      } as never
    }
    expect(remoteSessionsByPath(list)).toEqual(new Map([['/work', [id('open-blank')]]]))
  })

  it('preserves local members and swaps the previous remote set', () => {
    expect(mergeWorkspaceMembers(
      [id('local'), id('old-remote')],
      new Set([id('old-remote')]),
      [id('remote')],
    )).toEqual([id('local'), id('remote')])
  })

  it('does not duplicate a member and removes the whole previous set', () => {
    expect(mergeWorkspaceMembers(
      [id('remote'), id('local')],
      new Set([id('remote')]),
      [id('remote')],
    )).toEqual([id('local'), id('remote')])
    expect(mergeWorkspaceMembers(
      [id('local'), id('remote')],
      new Set([id('remote')]),
      [],
    )).toEqual([id('local')])
  })
})
