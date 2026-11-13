/**
 * Batch archive behind the management tab.
 *
 * The Host installs a complete archive set per call and refuses a Session whose work is still
 * running. The batch therefore runs one Session at a time and keeps going after a refusal, so the
 * outcome can be reported instead of stopping at the first failure.
 * @module dsh-plugin-session-manager/client/archive
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** How a batch archive settled. */
export interface ArchiveOutcome {
  /** Sessions the Host accepted, in selection order. */
  readonly archived: readonly SessionId[]
  /** Sessions the Host refused, in selection order. */
  readonly failed: readonly SessionId[]
}

/**
 * Archive the selected Sessions one at a time.
 * @param sessionIds - Sessions the user selected.
 * @param archive - Host archive command for one Session.
 * @returns the accepted and refused ids, in selection order.
 */
export async function archiveSessions(
  sessionIds: readonly SessionId[],
  archive: (sessionId: SessionId) => Promise<void>,
): Promise<ArchiveOutcome> {
  const archived: SessionId[] = []
  const failed: SessionId[] = []

  for (const sessionId of sessionIds) {
    try {
      await archive(sessionId)
      archived.push(sessionId)
    } catch {
      failed.push(sessionId)
    }
  }

  return { archived, failed }
}
