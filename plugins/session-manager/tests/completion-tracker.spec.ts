import { describe, expect, it } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  clearLocalCompletion,
  localCompletionIds,
  startCompletionTracker,
} from '../src/client/completion-tracker.ts'

/** Minimal observable source the tracker subscribes to. */
class Source<T> {
  private value: T
  private readonly listeners = new Set<(value: T) => void>()

  constructor(value: T) {
    this.value = value
  }

  getSnapshot(): T {
    return this.value
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  set(value: T): void {
    this.value = value
    for (const listener of this.listeners) listener(value)
  }
}

/** One ordinary list row; the tracker only reads running, retention, and the filter flags. */
function row(
  id: SessionId,
  options: { running: boolean; mainView?: number; sessionManager?: number },
): Record<string, unknown> {
  return {
    id,
    workspaceId: 'workspace',
    blank: false,
    origin: 'user',
    running: options.running,
    updatedAt: 100,
    retainedBy: {
      mainView: options.mainView ?? 0,
      sessionManager: options.sessionManager ?? 0,
    },
  }
}

/** A ready list snapshot around the given rows. */
function listOf(ids: readonly SessionId[], rows: readonly Record<string, unknown>[]): SessionListState {
  return {
    phase: 'ready',
    ids,
    byId: Object.fromEntries(rows.map((item) => [item.id, item])),
    projectionsBySession: {},
  } as unknown as SessionListState
}

/** Start the tracker against fake services. */
function start(
  list: Source<SessionListState>,
  statuses: Source<Map<SessionId, { running: boolean }>>,
  panel: Source<{ activePanelId: string | null }>,
): void {
  startCompletionTracker({
    effect(callback: () => () => void) {
      return callback()
    },
    uiSession: { sessionStatus: statuses },
    sessions: { list },
    layout: { panelInfo: panel },
  } as never)
}

describe('completion tracker', () => {
  it('records a stop while a global panel hides a mainView Session', () => {
    const id = 'hidden' as SessionId
    const list = new Source(listOf([id], [row(id, { running: true, mainView: 1 })]))
    const statuses = new Source(new Map([[id, { running: true }]]))
    const panel = new Source({ activePanelId: 'session-manager' })
    clearLocalCompletion(id)
    start(list, statuses, panel)

    statuses.set(new Map([[id, { running: false }]]))

    expect(localCompletionIds(list.getSnapshot()).has(id)).toBe(true)
    clearLocalCompletion(id)
  })

  it('does not record a stop in the visible conversation', () => {
    const id = 'visible' as SessionId
    const list = new Source(listOf([id], [row(id, { running: true, mainView: 1 })]))
    const statuses = new Source(new Map([[id, { running: true }]]))
    const panel = new Source({ activePanelId: null })
    clearLocalCompletion(id)
    start(list, statuses, panel)

    statuses.set(new Map([[id, { running: false }]]))

    expect(localCompletionIds(list.getSnapshot()).has(id)).toBe(false)
  })

  it('does not record a stop while the board previews the Session', () => {
    const id = 'previewed' as SessionId
    const list = new Source(listOf([id], [row(id, { running: true, sessionManager: 1 })]))
    const statuses = new Source(new Map([[id, { running: true }]]))
    const panel = new Source({ activePanelId: 'session-manager' })
    clearLocalCompletion(id)
    start(list, statuses, panel)

    statuses.set(new Map([[id, { running: false }]]))

    expect(localCompletionIds(list.getSnapshot()).has(id)).toBe(false)
  })

  it('clears a local completion when the board opens the Session', () => {
    const id = 'previewed-later' as SessionId
    const list = new Source(listOf([id], [row(id, { running: true })]))
    const statuses = new Source(new Map([[id, { running: true }]]))
    const panel = new Source({ activePanelId: 'session-manager' })
    clearLocalCompletion(id)
    start(list, statuses, panel)

    statuses.set(new Map([[id, { running: false }]]))
    expect(localCompletionIds(list.getSnapshot()).has(id)).toBe(true)

    list.set(listOf([id], [row(id, { running: false, sessionManager: 1 })]))

    expect(localCompletionIds(list.getSnapshot()).has(id)).toBe(false)
  })

  it('clears a local completion when the conversation becomes visible', () => {
    const id = 'opened' as SessionId
    const list = new Source(listOf([id], [row(id, { running: true, mainView: 1 })]))
    const statuses = new Source(new Map([[id, { running: true }]]))
    const panel = new Source({ activePanelId: 'session-manager' })
    clearLocalCompletion(id)
    start(list, statuses, panel)

    statuses.set(new Map([[id, { running: false }]]))
    expect(localCompletionIds(list.getSnapshot()).has(id)).toBe(true)

    panel.set({ activePanelId: null })
    expect(localCompletionIds(list.getSnapshot()).has(id)).toBe(false)
  })

  it('clears a local completion when the Session runs again', () => {
    const id = 'rerun' as SessionId
    const list = new Source(listOf([id], [row(id, { running: true, mainView: 1 })]))
    const statuses = new Source(new Map([[id, { running: true }]]))
    const panel = new Source({ activePanelId: 'session-manager' })
    clearLocalCompletion(id)
    start(list, statuses, panel)

    statuses.set(new Map([[id, { running: false }]]))
    expect(localCompletionIds(list.getSnapshot()).has(id)).toBe(true)

    statuses.set(new Map([[id, { running: true }]]))
    expect(localCompletionIds(list.getSnapshot()).has(id)).toBe(false)
    clearLocalCompletion(id)
  })
})
