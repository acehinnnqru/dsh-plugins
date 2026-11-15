import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { isRosterFrame, rosterStream, type RosterFrame, type RosterSource } from '../src/network/roster.ts'

/** One summary row. */
function summary(sessionId: string): SessionSummary {
  return {
    agentAvailable: true,
    sessionId: sessionId as SessionId,
    updatedAt: 1,
    running: false,
    blank: false,
  }
}

/** One source with a controlled listener set. */
function source(items: readonly SessionSummary[] = []): {
  readonly source: RosterSource
  emit(frame: RosterFrame): void
  readonly lists: () => number
} {
  const listeners = new Set<(frame: RosterFrame) => void>()
  let lists = 0
  return {
    source: {
      list: async () => {
        lists += 1
        return { items }
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    emit: (frame) => {
      for (const listener of listeners) listener(frame)
    },
    lists: () => lists,
  }
}

describe('roster stream', () => {
  it('sends one snapshot, then every live change, then ends on abort', async () => {
    const channel = source([summary('a')])
    const abort = new AbortController()
    const iterator = rosterStream(channel.source, abort.signal)[Symbol.asyncIterator]()

    const first = await iterator.next()
    expect(first.value).toMatchObject({ type: 'roster/snapshot' })
    if (first.value?.type === 'roster/snapshot') {
      expect(first.value.items.map((item) => item.sessionId)).toEqual(['a'])
    }

    channel.emit({ type: 'roster/status', sessionId: 'a', running: true })
    expect(await iterator.next()).toMatchObject({ value: { type: 'roster/status', sessionId: 'a', running: true } })

    channel.emit({ type: 'roster/activity', sessionId: 'a', updatedAt: 42 })
    expect(await iterator.next()).toMatchObject({ value: { type: 'roster/activity', updatedAt: 42 } })

    abort.abort()
    expect(await iterator.next()).toMatchObject({ done: true })
    expect(channel.lists()).toBe(1)
  })

  it('keeps a change that lands while the snapshot is being read', async () => {
    const listeners = new Set<(frame: RosterFrame) => void>()
    const frames: RosterFrame[] = []
    const channel: RosterSource = {
      list: async () => {
        // The subscriber attaches before the listing, so this must survive it.
        for (const listener of listeners) listener({ type: 'roster/added', summary: summary('late') })
        return { items: [summary('a')] }
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    }
    const abort = new AbortController()
    const iterator = rosterStream(channel, abort.signal)[Symbol.asyncIterator]()
    frames.push((await iterator.next()).value as RosterFrame)
    frames.push((await iterator.next()).value as RosterFrame)
    abort.abort()
    await iterator.next()

    expect(frames.map((frame) => frame.type)).toEqual(['roster/snapshot', 'roster/added'])
    if (frames[1].type === 'roster/added') expect(frames[1].summary.sessionId).toBe('late')
  })

  it('detaches its listeners when the consumer stops early', async () => {
    const channel = source([summary('a')])
    const abort = new AbortController()
    const iterator = rosterStream(channel.source, abort.signal)[Symbol.asyncIterator]()
    await iterator.next()
    channel.emit({ type: 'roster/heartbeat' })
    await iterator.next()
    await iterator.return?.(undefined)
    // A frame pushed after cleanup must not reach the closed queue.
    channel.emit({ type: 'roster/status', sessionId: 'a', running: true })
    expect((await iterator.next()).done).toBe(true)
  })
})

describe('roster frame validation', () => {
  it('accepts every frame this protocol defines', () => {
    expect(isRosterFrame({ type: 'roster/snapshot', items: [] })).toBe(true)
    expect(isRosterFrame({ type: 'roster/added', summary: summary('a') })).toBe(true)
    expect(isRosterFrame({ type: 'roster/removed', sessionId: 'a' })).toBe(true)
    expect(isRosterFrame({ type: 'roster/status', sessionId: 'a', running: false })).toBe(true)
    expect(isRosterFrame({ type: 'roster/activity', sessionId: 'a', updatedAt: 1 })).toBe(true)
    expect(isRosterFrame({ type: 'roster/heartbeat' })).toBe(true)
  })

  it('rejects anything else off the bridge', () => {
    expect(isRosterFrame(null)).toBe(false)
    expect(isRosterFrame('roster/snapshot')).toBe(false)
    expect(isRosterFrame({ type: 'roster/snapshot' })).toBe(false)
    expect(isRosterFrame({ type: 'roster/added' })).toBe(false)
    expect(isRosterFrame({ type: 'roster/status', sessionId: 'a' })).toBe(false)
    expect(isRosterFrame({ type: 'roster/activity', sessionId: 'a' })).toBe(false)
    expect(isRosterFrame({ type: 'session.list' })).toBe(false)
  })
})
