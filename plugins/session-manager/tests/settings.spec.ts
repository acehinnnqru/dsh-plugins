/**
 * The settings dialog is only served when every network field is volatile and
 * the schema resolves a usable default. Pin both facts.
 */
import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'

describe('network settings schema', () => {
  it('marks every editable network field volatile', () => {
    const dict = Config.dict as Record<string, { meta?: { volatile?: boolean } }>
    for (const field of ['server', 'token', 'name']) {
      expect(dict[field]?.meta?.volatile, field).toBe(true)
    }
  })

  it('resolves defaults through live refs', () => {
    const value = Config({}) as Record<string, { get(): unknown }>
    expect(value['server']?.get()).toBe('')
    expect(value['token']?.get()).toBe('')
    expect(value['name']?.get()).toBe('')
  })
})
