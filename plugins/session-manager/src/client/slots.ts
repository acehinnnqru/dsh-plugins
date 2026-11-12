/**
 * The one child slot the board page declares for its native conversation preview.
 *
 * The page owns the declaration; `index.tsx` registers the host into it, and the page renders it
 * inside a `SessionProvider` bound to the previewed Session. The `SlotMap` row lives here so every
 * module that names the slot sees the same declaration.
 * @module dsh-plugin-session-manager/client/slots
 */

/** Session-scoped slot hosting the native Conversation body in the preview subpage. */
export const CONVERSATION_SLOT = 'session-manager.conversation' as const

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Session-scoped native Conversation body hosted by the board's preview subpage. */
    'session-manager.conversation': {
      kind: 'single'
      scope: 'session'
    }
  }
}
