import { describe, expect, it } from 'vitest'
import { apply, name } from '../src/index.ts'

describe('session-manager host half', () => {
  it('declares the loader name diagnostics show', () => {
    expect(name).toBe('session-manager')
  })

  it('adds nothing to the host tree', () => {
    expect(apply()).toBeUndefined()
  })
})
