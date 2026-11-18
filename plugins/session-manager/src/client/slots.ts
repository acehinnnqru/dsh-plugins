/**
 * The child slots the board page declares for its native Conversation surfaces.
 *
 * The page owns the declarations; `index.tsx` registers a host into each, and the page renders one
 * inside a `SessionProvider` bound to the Session the surface created or retained. The `SlotMap`
 * rows live here so every module that names a slot sees the same declaration.
 * @module dsh-plugin-session-manager/client/slots
 */

/** Session-scoped slot hosting the native Conversation body in an embedded surface. */
export const CONVERSATION_SLOT = 'session-manager.conversation' as const

/** Session-scoped slot hosting only the native composer chain of a waiting Session. */
export const WAITING_SLOT = 'session-manager.waiting' as const

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Session-scoped native Conversation body hosted by the new-conversation overlay. */
    'session-manager.conversation': {
      kind: 'single'
      scope: 'session'
    }
    /** Session-scoped native approval or question block hosted by the waiting dialog. */
    'session-manager.waiting': {
      kind: 'single'
      scope: 'session'
    }
  }
}
