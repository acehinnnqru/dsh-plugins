/**
 * Pure phase decision for the embedded Conversation occurrence.
 *
 * The shared `conversation.content` Factory wants a variant and a body phase; the main Conversation
 * derives them from the Session and Conversation snapshots. The preview host is not the main shell,
 * so it repeats that small decision here — outside React and the Factory seat, which keeps it
 * testable without a browser.
 * @module dsh-plugin-session-manager/client/conversation-input
 */

import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** The input the shared `conversation.content` Factory takes from a presenting host. */
export interface ConversationContentInput {
  /** A non-main host: the embedded layout sets its own content width. */
  readonly variant: 'embedded'
  /** Which body phase the Factory should render. */
  readonly phase: 'settling' | 'hero' | 'active'
  /** Whether the hero chrome is part of the phase. */
  readonly hero: boolean
}

/** The Session and Conversation facts the phase decision reads. */
export interface ConversationPhaseFacts {
  /** Bound Session snapshot. */
  readonly session: Pick<
    SessionSnapshot,
    'blank' | 'awaitingFirstTurn' | 'running' | 'promptAttempted' | 'openState' | 'subagent'
  >
  /** Bound Conversation snapshot. */
  readonly conversation: Pick<ConversationSnapshot, 'activeTargets'>
  /** The list row's blank hint, which may arrive before the Session binding settles. */
  readonly summaryBlank: boolean | undefined
}

/**
 * Decide the embedded Factory input.
 *
 * The shell phase mirrors the main Conversation's own rule: any active target, an engaged Session,
 * or a running turn is active; a Session that has attempted a prompt but not started is engaging;
 * anything else is blank. Settling covers an opening blank Session and a continuable subagent whose
 * parent availability is still unresolved. Hero covers a blank Session that is already open or
 * known blank from the list.
 * @param facts - Session, Conversation, and list-row hints.
 * @returns the Factory input for the embedded occurrence.
 */
export function conversationContentInput(facts: ConversationPhaseFacts): ConversationContentInput {
  const { session, conversation, summaryBlank } = facts
  const shellPhase = conversation.activeTargets.size > 0
    || (!session.blank && !session.awaitingFirstTurn)
    || session.running
    ? 'active'
    : session.promptAttempted ? 'engaging' : 'blank'
  const parentAvailabilityPending = session.subagent?.address.mode === 'continuable'
    && session.subagent.parentAvailable === undefined
  const settling = (shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true)
    || parentAvailabilityPending
  const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)

  return {
    variant: 'embedded',
    phase: settling ? 'settling' : hero ? 'hero' : 'active',
    hero,
  }
}
