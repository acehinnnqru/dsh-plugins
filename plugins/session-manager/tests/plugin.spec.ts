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

  it('adds no network runtime when networking is off', () => {
    const requested: string[][] = []
    const ctx = {
      inject: (deps: string[]) => {
        requested.push(deps)
        return () => {}
      },
      on: () => () => {},
      logger: { info: () => {}, warn: () => {} },
    }
    expect(apply(ctx as never, off)).toBeUndefined()
    expect(requested).toEqual([['connection'], ['sessionController']])
  })
})
