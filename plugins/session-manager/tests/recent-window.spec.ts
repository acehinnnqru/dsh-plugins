import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('recent window store', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', storage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to three days and persists a choice', async () => {
    const first = await import('../src/client/recent-window.ts')
    expect(first.recentWindowDays()).toBe(3)

    first.setRecentWindowDays(7)
    expect(first.recentWindowDays()).toBe(7)

    vi.resetModules()
    const second = await import('../src/client/recent-window.ts')
    expect(second.recentWindowDays()).toBe(7)
  })

  it('ignores an invalid stored value', async () => {
    localStorage.setItem('dsh.session-manager.recent-window.v1', JSON.stringify(99))

    const store = await import('../src/client/recent-window.ts')
    expect(store.recentWindowDays()).toBe(3)
  })

  it('notifies subscribers until they unsubscribe', async () => {
    const store = await import('../src/client/recent-window.ts')
    let calls = 0
    const stop = store.subscribeRecentWindow(() => {
      calls += 1
    })

    store.setRecentWindowDays(1)
    expect(calls).toBe(1)
    store.setRecentWindowDays(1)
    expect(calls).toBe(1)
    store.setRecentWindowDays(3)
    expect(calls).toBe(2)
    stop()
    store.setRecentWindowDays(7)
    expect(calls).toBe(2)
  })
})
