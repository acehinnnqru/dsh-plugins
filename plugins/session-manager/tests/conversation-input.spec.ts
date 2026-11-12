import { describe, expect, it } from 'vitest'
import { conversationContentInput, type ConversationPhaseFacts } from '../src/client/conversation-input.ts'

/**
 * Build the minimal Session/Conversation facts the phase decision reads.
 * @param overrides - facts the case wants to change.
 * @returns a complete facts object.
 */
function facts(overrides: {
  session?: Record<string, unknown>
  activeTargets?: number
  summaryBlank?: boolean
} = {}): ConversationPhaseFacts {
  return {
    session: {
      blank: false,
      awaitingFirstTurn: false,
      running: false,
      promptAttempted: false,
      openState: 'open',
      subagent: null,
      ...overrides.session,
    },
    conversation: {
      activeTargets: new Set(
        Array.from({ length: overrides.activeTargets ?? 0 }, (_, index) => `target-${index}`),
      ),
    },
    summaryBlank: overrides.summaryBlank,
  } as unknown as ConversationPhaseFacts
}

describe('conversationContentInput', () => {
  it('uses the embedded variant for an ordinary active Session', () => {
    expect(conversationContentInput(facts())).toEqual({
      variant: 'embedded',
      phase: 'active',
      hero: false,
    })
  })

  it('shows the hero body for a blank open Session', () => {
    expect(conversationContentInput(facts({
      session: { blank: true, openState: 'open' },
      summaryBlank: true,
    }))).toEqual({
      variant: 'embedded',
      phase: 'hero',
      hero: true,
    })
  })

  it('shows the settling body while a blank Session opens', () => {
    expect(conversationContentInput(facts({
      session: { blank: true, openState: 'loading' },
      summaryBlank: false,
    }))).toEqual({
      variant: 'embedded',
      phase: 'settling',
      hero: false,
    })
  })

  it('settles while a continuable subagent parent is unresolved', () => {
    expect(conversationContentInput(facts({
      session: {
        subagent: { address: { mode: 'continuable' }, parentAvailable: undefined },
      },
      summaryBlank: false,
    }))).toEqual({
      variant: 'embedded',
      phase: 'settling',
      hero: false,
    })
  })

  it('treats active targets as active even for a blank Session', () => {
    expect(conversationContentInput(facts({
      session: { blank: true, openState: 'open' },
      activeTargets: 1,
      summaryBlank: true,
    }))).toEqual({
      variant: 'embedded',
      phase: 'active',
      hero: false,
    })
  })
})
