import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { REMOTE_PIN_KEY, readRemotePins, toggleRemotePin, writeRemotePins, type PinStorage } from '../src/client/remote-pins.ts'

/** In-memory storage for the browser store. */
function storage(initial: string | null = null): PinStorage & { value: string | null } {
  return {
    value: initial,
    getItem(key: string): string | null {
      return key === REMOTE_PIN_KEY ? this.value : null
    },
    setItem(key: string, value: string): void {
      if (key === REMOTE_PIN_KEY) this.value = value
    },
  }
}

const a = 's-a' as SessionId
const b = 's-b' as SessionId

describe('remote pins', () => {
  it('reads a clean, de-duplicated order', () => {
    const store = storage(JSON.stringify([a, b, a, 3, '']))
    expect(readRemotePins(store)).toEqual([a, b])
  })

  it('falls back to an empty order for missing or broken data', () => {
    expect(readRemotePins(storage())).toEqual([])
    expect(readRemotePins(storage('{'))).toEqual([])
    expect(readRemotePins(storage('"not-an-array"'))).toEqual([])
    expect(readRemotePins(undefined)).toEqual([])
  })

  it('writes the order it is given', () => {
    const store = storage()
    writeRemotePins([a, b], store)
    expect(readRemotePins(store)).toEqual([a, b])
  })

  it('moves a pinned Session to the front and removes an unpinned one', () => {
    expect(toggleRemotePin([b], a, false)).toEqual([a, b])
    expect(toggleRemotePin([a, b], a, true)).toEqual([b])
    expect(toggleRemotePin([a], a, false)).toEqual([a])
  })
})
