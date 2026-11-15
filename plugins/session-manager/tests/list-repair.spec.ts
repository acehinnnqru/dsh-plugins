import { describe, expect, it } from 'vitest'
import { ListRepair } from '../src/client/list-repair.ts'

describe('ListRepair', () => {
  it('requests one listing and throttles the requests inside the floor', () => {
    let now = 10_000
    let calls = 0
    const repair = new ListRepair(async () => {
      calls += 1
    }, () => now, 30_000)

    expect(repair.request()).toBe(true)
    expect(repair.request()).toBe(false)
    expect(calls).toBe(1)

    now += 29_999
    expect(repair.request()).toBe(false)

    now += 1
    expect(repair.request()).toBe(true)
    expect(calls).toBe(2)
  })

  it('contains a listing failure', async () => {
    const repair = new ListRepair(async () => {
      throw new Error('offline')
    }, () => 0, 0)

    expect(repair.request()).toBe(true)
    await Promise.resolve()
  })
})
