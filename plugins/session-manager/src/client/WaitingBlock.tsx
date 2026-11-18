/**
 * The native answer block for a waiting Session, rendered inside the board's waiting dialog.
 *
 * The approval card and the question composer are entries of the Conversation composer chain, not
 * standalone exports. This host instantiates the shared `conversation.content` Factory with a null
 * `views` component, so the Factory renders the composer seat and skips the transcript. The chain
 * then elects the approval or question entry exactly as it does on the Session page.
 *
 * The host renders nothing without an answerable interaction: a shared-status placeholder names a
 * waiting kind but owns no answer channel, and the Factory would otherwise fall back to the ordinary
 * composer bar.
 * @module dsh-plugin-session-manager/client/waiting-block
 */

import type { ReactNode } from 'react'
import type { PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: carries the Factory contract, the session standard hooks, and the Workspace selector.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { waitingBlockKind } from './board.ts'
import { conversationContentInput } from './conversation-input.ts'
import { NS } from './locales.ts'
import { WAITING_SLOT } from './slots.ts'
import css from './SessionBoard.module.css'

/** Session standard kit, the Factory render seat, and this plugin's copy. */
type WaitingBlockProps = PropsRuntime<typeof WAITING_SLOT> & PropsRenderFactories & PropsLocale<typeof NS>

/**
 * Skip the Conversation transcript; the waiting dialog wants only the composer seat's takeover.
 * @returns nothing.
 */
function NoConversationViews(): ReactNode {
  return null
}

/**
 * Render the pending approval or question block for the bound Session.
 *
 * A blank Session and a Session without an answerable interaction both render nothing; the page
 * owns closing the dialog when the request settles.
 * @param props - session standard props, Factory rendering, and copy.
 * @returns the native answer block, or nothing when the request is gone.
 */
export function SessionWaitingBlock(props: WaitingBlockProps): ReactNode {
  const { sessionId, useSession, useSessionStatus, useConversation, useSessions, renderFactorySlot, t } = props
  const session = useSession((value) => value)
  const conversation = useConversation((value) => value)
  const summaryBlank = useSessions((state) => state.byId[sessionId]?.blank)
  const interaction = useSessionStatus((snapshot) => snapshot.get(sessionId)?.pendingInteraction)
  const input = conversationContentInput({ session, conversation, summaryBlank })
  if (waitingBlockKind(interaction) === undefined) return null

  return renderFactorySlot('conversation.content', input, {
    slots: { views: NoConversationViews },
    fallback: <p className={css.unavailable}>{t('conversation.unavailable')}</p>,
  })
}
