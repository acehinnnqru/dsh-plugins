import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** A minimal localStorage backed by a Map, so persistence can be asserted. */
function storage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear() {
      data.clear()
    },
    getItem(key: string) {
      return data.get(key) ?? null
    },
    key(index: number) {
      return [...data.keys()][index] ?? null
    },
    removeItem(key: string) {
      data.delete(key)
    },
    setItem(key: string, value: string) {
      data.set(key, value)
    },
  }
}

describe('pin store', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', storage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('toggles a pin and reloads it from storage', async () => {
    const id = 'pinned' as SessionId
    const first = await import('../src/client/pins.ts')
    first.togglePin(id)

    expect(first.pinnedSessionIds()).toEqual([id])

    vi.resetModules()
    const second = await import('../src/client/pins.ts')
    expect(second.pinnedSessionIds()).toEqual([id])
    second.togglePin(id)
    expect(second.pinnedSessionIds()).toEqual([])
  })

  it('notifies subscribers until they unsubscribe', async () => {
    const id = 'notified' as SessionId
    const pins = await import('../src/client/pins.ts')
    let calls = 0
    const stop = pins.subscribePins(() => {
      calls += 1
    })

    pins.togglePin(id)
    expect(calls).toBe(1)
    stop()
    pins.togglePin(id)
    expect(calls).toBe(1)
  })
})
