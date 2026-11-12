/**
 * `dsh-plugin-session-manager`, browser half.
 *
 * One panel, four registrations: the sidebar row that launches it, the page itself in the main
 * column, the session-scoped host for the waiting dialog's embedded Conversation, and the leading
 * control that returns to the board. The page and the sidebar row share the same id because the
 * sidebar resolves a panel row by selecting the main key of the same name.
 *
 * Only values from DSH baseline modules may be imported; every cross-package import below is
 * type-only and exists for its declaration merge. The bundle build refuses the alternative on
 * purpose.
 * @module dsh-plugin-session-manager/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: they carry the declaration merges for ctx.locale, ctx.slots, ctx.sessions,
// ctx.uiWorkspace, and the 'main' / 'sidebar.panellist' SlotMap rows.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { BackToBoard } from './BackToBoard.tsx'
import { disarmBackToBoard } from './back-to-board.ts'
import { startCompletionTracker } from './completion-tracker.ts'
import { SessionConversationHost } from './ConversationHost.tsx'
import { SessionBoardPage, type SessionManagerInjected } from './SessionBoardPage.tsx'
import { SessionManagerIcon } from './SessionManagerIcon.tsx'
import { en, NS, zh } from './locales.ts'
import { CONVERSATION_SLOT } from './slots.ts'

/** The panel's id: the main column's key and the sidebar row's list id have to be the same value. */
const PANEL_ID = 'session-manager' as MainPanelId

/** After the shipped Plugins row (0), Automation tasks row (10), and the other plugin panels. */
const PANEL_ORDER = 30

/** Cordis service names this half waits for: slots, locale, Session retention, Session status, and navigation. */
export const inject = ['slots', 'locale', 'sessions', 'uiSession', 'uiWorkspace', 'layout']

/**
 * Contribute the board page, its preview child, and its sidebar row.
 * @param ctx - client context carrying the slot registry, locale, and Session service.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-manager: dictionaries')
  const t = ctx.locale.bind(NS)

  startCompletionTracker(ctx)

  // A global panel is not the Session page; a marker left by an earlier board visit is stale.
  ctx.effect(() => ctx.layout.panelInfo.subscribe(() => {
    if (ctx.layout.panelInfo.getSnapshot().activePanelId !== null) disarmBackToBoard()
  }), 'session-manager: back marker')

  const retainSession = (sessionId: SessionId): SessionReference =>
    ctx.sessions.retain(sessionId, { source: 'sessionManager' })
  const openSession = (sessionId: SessionId): void => {
    ctx.uiWorkspace.openSession(sessionId)
  }

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    children: {
      [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' },
    },
    inject: (): SessionManagerInjected => ({ retainSession, openSession }),
  }, SessionBoardPage))

  // The page declares the child slot above; waiting for its declaration lets the host register in
  // either plugin order without touching a slot that does not exist yet.
  ctx.slots.inject(CONVERSATION_SLOT, () => ctx.slots.register({
    name: CONVERSATION_SLOT,
    locale: NS,
  }, SessionConversationHost))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: PANEL_ORDER,
    locale: NS,
    label: () => t('panel.title'),
  }, SessionManagerIcon))

  // Before the Session title, where a back arrow belongs. The leading seat is single; if another
  // navigation plugin already owns it, keep the control in the header actions instead of failing.
  const goBack = (): void => {
    disarmBackToBoard()
    ctx.layout.selectPanel(PANEL_ID)
  }
  const backShare: {
    readonly locale: typeof NS
    readonly inject: () => { readonly goBack: () => void }
  } = {
    locale: NS,
    inject: () => ({ goBack }),
  }
  ctx.slots.inject('conversation.header.leading', () => {
    try {
      return ctx.slots.register({
        name: 'conversation.header.leading',
        ...backShare,
      }, BackToBoard)
    } catch {
      return ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'session-manager-back',
        order: -100,
        ...backShare,
      }, BackToBoard)
    }
  })
}
