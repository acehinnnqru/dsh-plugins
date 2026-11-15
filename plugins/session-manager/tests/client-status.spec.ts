import { describe, expect, it } from 'vitest'
import { SharedStatusStore } from '../src/client/status.ts'

describe('SharedStatusStore', () => {
  it('marks a locally observed running edge before the shared poll', () => {
    const store = new SharedStatusStore()
    store.noteRunning('remote')
    const row = store.getSnapshot().get('remote')
    expect(row).toMatchObject({ sessionId: 'remote', running: true, unread: false })
  })

  it('keeps a row running when the native edge is already installed', () => {
    const store = new SharedStatusStore()
    store.noteRunning('remote')
    store.noteRunning('remote')
    expect(store.getSnapshot().get('remote')?.running).toBe(true)
  })

  it('holds the running edge while the shared poll is still stale', async () => {
    const previous = globalThis.fetch
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        statuses: [{
          sessionId: 'remote',
          running: false,
          pending: null,
          unread: false,
          updatedAt: 1,
          readAt: 0,
        }],
      }),
    })) as unknown as typeof fetch
    try {
      const store = new SharedStatusStore()
      store.start()
      await new Promise((resolve) => setTimeout(resolve, 0))
      store.noteRunning('remote')
      await store.refresh()
      expect(store.getSnapshot().get('remote')?.running).toBe(true)
      store.stop()
    } finally {
      globalThis.fetch = previous
    }
  })
})
