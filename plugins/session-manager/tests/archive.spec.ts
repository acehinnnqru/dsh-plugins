import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { archiveSessions } from '../src/client/archive.ts'

/**
 * The management tab's batch step.
 *
 * The component owns the selection and the confirmation; this covers the loop that has to keep
 * going after the Host refuses a Session whose work is still running.
 */

/** Brand a literal string as a Session id. */
function id(value: string): SessionId {
  return value as SessionId
}

describe('archiveSessions', () => {
  it('archives every Session in selection order', async () => {
    const calls: SessionId[] = []
    const result = await archiveSessions([id('a'), id('b')], async (sessionId) => {
      calls.push(sessionId)
    })

    expect(calls).toEqual([id('a'), id('b')])
    expect(result).toEqual({ archived: [id('a'), id('b')], failed: [] })
  })

  it('keeps going after a refusal and reports the refused ids', async () => {
    const refused = new Set([id('b')])
    const attempted: SessionId[] = []
    const result = await archiveSessions([id('a'), id('b'), id('c')], async (sessionId) => {
      attempted.push(sessionId)
      if (refused.has(sessionId)) throw new Error('workspace/session-active')
    })

    expect(attempted).toEqual([id('a'), id('b'), id('c')])
    expect(result.archived).toEqual([id('a'), id('c')])
    expect(result.failed).toEqual([id('b')])
  })

  it('does nothing for an empty selection', async () => {
    const result = await archiveSessions([], async () => {
      throw new Error('must not run')
    })

    expect(result).toEqual({ archived: [], failed: [] })
  })
})
