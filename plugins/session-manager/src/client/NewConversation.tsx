/**
 * The full-screen new-conversation overlay.
 *
 * The overlay does not reimplement an input: it embeds the shared `conversation.content` Factory for
 * a freshly created blank Session, so the native hero row (our searchable Workspace picker in its
 * Workspace seat, the native Agent preset chip) and the composer, with its command and reference
 * support and the question/approval takeovers, travel with it. The hero headline is hidden by the
 * overlay's CSS: a white rounded panel over the mask holds those controls. Picking another Workspace
 * stays in the overlay: the page swaps to a blank Session there and carries the draft text.
 *
 * The Modal supplies the full-viewport mask, initial focus, Escape, and focus return. Sending is the
 * only thing this module watches: the Session snapshot publishes accepted prompts, and that edge
 * hands the board back. Closing without sending leaves the blank Session reusable, exactly where the
 * native New Session action expects to find one.
 * @module dsh-plugin-session-manager/client/new-conversation
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import { CONVERSATION_SLOT } from './slots.ts'
import css from './SessionBoard.module.css'

/** The Session scoping and child rendering the page already holds for its embedded Conversation. */
type ConversationSeat = Pick<
  PropsRenderSlots<typeof CONVERSATION_SLOT>,
  'renderSlot' | 'SessionProvider'
>

/** Props of the overlay. */
interface NewConversationProps extends ConversationSeat {
  /** Retained blank Session the new conversation runs in. */
  readonly reference: SessionReference
  /** This namespace's translate function. */
  readonly t: PropsLocale<typeof NS>['t']
  /** The prompt was accepted; the board takes the screen back. */
  readonly onSent: () => void
  /** The user dismissed the overlay without sending. */
  readonly onClose: () => void
}

/**
 * Render the native blank-session Conversation over the board.
 *
 * The Modal mask is the full-screen layer; the dialog is the native new-conversation surface, and
 * the Factory's hero phase centers its stack inside it.
 * @param props - the retained Session, the Conversation seats, copy, and the two exits.
 * @returns the portaled overlay.
 */
export function NewConversation({
  reference,
  t,
  renderSlot,
  SessionProvider,
  onSent,
  onClose,
}: NewConversationProps): ReactNode {
  const sent = useRef(onSent)
  useEffect(() => {
    sent.current = onSent
  }, [onSent])

  // An echo enters the snapshot only after the Host accepted the prompt, so a refused send keeps the
  // overlay (and the draft) in place while the native composer shows the failure.
  useEffect(() => {
    const session = reference.binding.session
    const shown = (): void => {
      if (session.getSnapshot().pendingSubmissions.length > 0) sent.current()
    }
    shown()
    return session.subscribe(shown)
  }, [reference])

  return (
    <Modal
      open
      headless
      title={t('new.title')}
      onClose={onClose}
      className={css.newDialog ?? ''}
    >
      <div className={css.newFrame}>
        <div className={css.newBody}>
          <SessionProvider session={reference}>
            {renderSlot(CONVERSATION_SLOT, {})}
          </SessionProvider>
        </div>
      </div>
    </Modal>
  )
}
