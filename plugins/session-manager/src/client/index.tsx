/**
 * `dsh-plugin-session-manager`, browser half.
 *
 * One panel, two registrations: the sidebar row that launches it and the page itself in the main
 * column. The id is shared by both because the sidebar resolves a panel row by selecting the main
 * key of the same name.
 *
 * Only values from DSH baseline modules may be imported; every cross-package import below is
 * type-only and exists for its declaration merge. The bundle build refuses the alternative on
 * purpose.
 * @module dsh-plugin-session-manager/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: they carry the declaration merges for ctx.locale, ctx.slots, ctx.uiWorkspace, and the
// 'main' / 'sidebar.panellist' SlotMap rows.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { SessionBoardPage, type SessionManagerInjected } from './SessionBoardPage.tsx'
import { SessionManagerIcon } from './SessionManagerIcon.tsx'
import { en, NS, zh } from './locales.ts'

/** The panel's id: the main column's key and the sidebar row's list id have to be the same value. */
const PANEL_ID = 'session-manager' as MainPanelId

/** After the shipped Plugins row (0), Automation tasks row (10), and the other plugin panels. */
const PANEL_ORDER = 30

/** Cordis service names this half waits for: the slot registry, locale, and Session navigation. */
export const inject = ['slots', 'locale', 'uiWorkspace']

/**
 * Contribute the board page and its sidebar row.
 * @param ctx - client context carrying the slot registry, locale, and Workspace navigation.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-manager: dictionaries')
  const t = ctx.locale.bind(NS)

  const openSession = (sessionId: SessionId): void => {
    ctx.uiWorkspace.openSession(sessionId)
  }

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: (): SessionManagerInjected => ({ openSession }),
  }, SessionBoardPage))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: PANEL_ORDER,
    locale: NS,
    label: () => t('panel.title'),
  }, SessionManagerIcon))
}
