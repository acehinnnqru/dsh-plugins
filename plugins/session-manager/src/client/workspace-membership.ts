/**
 * Client-side Workspace membership for federated Sessions.
 *
 * The Host Workspace registry only knows local Session ids, so a peer row is not
 * a member of any Workspace projection. The native new-session shell requires
 * that membership before it enables the composer. These pure helpers compute a
 * matching-path overlay without writing the Host registry.
 * @module dsh-plugin-session-manager/client/workspace-membership
 */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sessionNodeOf } from './board.ts'

/**
 * Group remote Session ids by their directory.
 * @param sessions - current federated Session list.
 * @returns one id list per directory, in list order.
 */
export function remoteSessionsByPath(sessions: SessionListState): Map<string, SessionId[]> {
  const result = new Map<string, SessionId[]>()
  for (const id of sessions.ids) {
    const row = sessions.byId[id]
    if (row === undefined || row.cwd === undefined) continue
    if (sessionNodeOf(sessions, id).self) continue
    // A parked remote blank must not become a native Workspace blank that the
    // local New Session action can try to reuse. Adopt it only while it is open.
    if (row.blank && !Object.values(row.retainedBy).some((count) => typeof count === 'number' && count > 0)) continue
    const ids = result.get(row.cwd) ?? []
    ids.push(id)
    result.set(row.cwd, ids)
  }
  return result
}

/**
 * Merge desired remote members into a Workspace row while preserving its local
 * members and removing only the remote ids this overlay added last time.
 * @param sessionIds - current Workspace membership.
 * @param previous - remote ids this overlay added previously.
 * @param desired - remote ids whose directory matches this Workspace now.
 * @returns the membership to install.
 */
export function mergeWorkspaceMembers(
  sessionIds: readonly SessionId[],
  previous: ReadonlySet<SessionId>,
  desired: readonly SessionId[],
): SessionId[] {
  const local = sessionIds.filter((id) => !previous.has(id))
  return [...local, ...desired.filter((id) => !local.includes(id))]
}
