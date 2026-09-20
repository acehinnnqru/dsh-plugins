import { describe, expect, it } from 'vitest'
import { diffAddress, diffTitle, parseDiffAddress } from '../src/client/address.ts'

describe('diff addresses', () => {
  it('round-trips a Session and a path, separators and all', () => {
    const address = diffAddress('session-1', 'a/b c/文 件.ts')

    expect(address).toBe('dsh-resource://workspace-diff/session/session-1/a%2Fb%20c%2F%E6%96%87%20%E4%BB%B6.ts')
    expect(parseDiffAddress(address)).toEqual({ sessionId: 'session-1', path: 'a/b c/文 件.ts' })
  })

  it('refuses an address it did not mint', () => {
    expect(parseDiffAddress('dsh-resource://changes-review/session/s1/3/2')).toBeUndefined()
    expect(parseDiffAddress('dsh-resource://workspace-diff/session/only-one-part')).toBeUndefined()
    expect(parseDiffAddress('dsh-resource://workspace-diff/session/s1/%E0%A4%A')).toBeUndefined()
  })

  it('titles a tab with the file name', () => {
    expect(diffTitle(diffAddress('s1', 'a/b/c.ts'))).toBe('c.ts')
    expect(diffTitle('not-ours')).toBe('not-ours')
  })
})
