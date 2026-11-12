import { beforeEach, describe, expect, it } from 'vitest'
import {
  armBackToBoard,
  backToBoardArmed,
  disarmBackToBoard,
  subscribeBackToBoard,
} from '../src/client/back-to-board.ts'

describe('back-to-board marker', () => {
  beforeEach(() => {
    disarmBackToBoard()
  })

  it('arms and disarms with one notification per change', () => {
    let calls = 0
    const stop = subscribeBackToBoard(() => {
      calls += 1
    })

    armBackToBoard()
    expect(backToBoardArmed()).toBe(true)
    expect(calls).toBe(1)

    armBackToBoard()
    expect(calls).toBe(1)

    disarmBackToBoard()
    expect(backToBoardArmed()).toBe(false)
    expect(calls).toBe(2)

    disarmBackToBoard()
    expect(calls).toBe(2)
    stop()
  })

  it('stops notifying after unsubscribe', () => {
    let calls = 0
    const stop = subscribeBackToBoard(() => {
      calls += 1
    })
    stop()

    armBackToBoard()
    expect(calls).toBe(0)
  })
})
