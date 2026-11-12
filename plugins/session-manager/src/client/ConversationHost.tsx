/**
 * The native Conversation body rendered inside the board's preview subpage.
 *
 * The page declares `session-manager.conversation` and binds it with `SessionProvider`; this
 * component is the occupant. It instantiates the shared `conversation.content` Factory exactly the
 * way the right-Sidebar subagent chat does, so the native transcript, composer, and the
 * question/approval composer takeovers all come along instead of being reimplemented here.
 *
 * The Factory is resolved by name through the renderer's `renderFactorySlot` prop; no cross-plugin
 * value import is involved.
 * @module dsh-plugin-session-manager/client/conversation
 */

import type { ReactNode } from 'react'
import type { PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: carries the Factory contract, the session standard hooks, and the Workspace selector.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { conversationContentInput } from './conversation-input.ts'
import { NS } from './locales.ts'
import { CONVERSATION_SLOT } from './slots.ts'
import css from './SessionBoard.module.css'

/** Session standard kit, the Factory render seat, and this plugin's copy. */
type ConversationHostProps =
  PropsRuntime<typeof CONVERSATION_SLOT>
  & PropsRenderFactories
  & PropsLocale<typeof NS>

/**
 * Render the Chat view only.
 *
 * The embeddable Conversation body leaves view selection to its caller. A preview is a conversation,
 * not a workspace inspector, so it pins the native Chat view and skips the Trajectory/Changes tabs.
 * @param props - the Factory's local `views` occurrence props.
 * @returns the native Conversation session body.
 */
function ChatOnlyView(props: ConversationViewsProps): ReactNode {
  return props.renderSlot('conversation.session', { view: 'chat' })
}

/**
 * Render the native Conversation for the bound preview Session.
 * @param props - session standard props, Factory rendering, and copy.
 * @returns the shared Conversation body, or a fallback when its Factory is not installed.
 */
export function SessionConversationHost(props: ConversationHostProps): ReactNode {
  const { sessionId, useSession, useConversation, useSessions, renderFactorySlot, t } = props
  const session = useSession((value) => value)
  const conversation = useConversation((value) => value)
  const summaryBlank = useSessions((state) => state.byId[sessionId]?.blank)
  const input = conversationContentInput({ session, conversation, summaryBlank })

  return renderFactorySlot('conversation.content', input, {
    slots: { views: ChatOnlyView },
    fallback: <p className={css.unavailable}>{t('preview.unavailable')}</p>,
  })
}
