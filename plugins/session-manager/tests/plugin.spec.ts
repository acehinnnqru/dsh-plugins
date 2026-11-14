import { describe, expect, it } from 'vitest'
import { apply, inject, name, type Config } from '../src/index.ts'

/** A profile with networking disabled. */
const off = {
  server: '',
  token: '',
  name: '',
} as unknown as Config

describe('session-manager host half', () => {
  it('declares the loader name diagnostics show', () => {
    expect(name).toBe('session-manager')
  })

  it('injects the Session Controller services used from this fiber', () => {
    expect(inject).toEqual(expect.arrayContaining(['sessionController', 'remoteAccess', 'sessions']))
  })

  it('adds nothing to the host tree when networking is off', () => {
    expect(apply({} as never, off)).toBeUndefined()
  })
})
