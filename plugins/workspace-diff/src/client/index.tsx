/**
 * dsh-plugin-workspace-diff, browser half.
 *
 * Two surfaces, one data path: a conversation.view entry that draws the changed files as a tree, and
 * a right-Sidebar tab type that draws one file's diff. The tree opens the tab through the Sidebar
 * service, so the container owns everything about the tab except its body.
 *
 * Only values from DSH baseline modules may be imported; every cross-package import below is
 * type-only and exists for its declaration merge. The bundle build refuses the alternative on
 * purpose.
 * @module dsh-plugin-workspace-diff/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: they carry the declaration merges for ctx.locale, ctx.slots, ctx.sidebarRight, the
// sessionId standard prop, and the 'conversation.view' / 'sidebar.right.pane.tab' SlotMap rows.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { diffAddress, diffTitle, parseDiffAddress, TAB_ID, TAB_KIND } from './address.ts'
import { createWorkspaceDiffApi } from './api.ts'
import { DiffTab, type DiffTabInjected } from './DiffTab.tsx'
import { en, NS, zh, type WorkspaceDiffKey } from './locales.ts'
import { WorkspaceDiffView, type WorkspaceDiffInjected } from './WorkspaceDiffView.tsx'

/** The Conversation slot this half occupies: the View tabs beside Chat and Trajectory. */
const SLOT = 'conversation.view'

/** Distinguishes this tab from the shipped ones in the same slot. */
const ID = 'workspace-diff'

/** After Chat (order 0) and Trajectory (order 10); a list sorts by priority, then order. */
const ORDER = 20

/** Cordis service names this plugin waits for: slots, locale, the Remote face, and the Sidebar. */
export const inject = ['slots', 'locale', 'remote', 'remote.workspaceFiles', 'sidebarRight', 'sidebarRightTabs']

/**
 * Whether a diff tab opens with line wrapping already on.
 *
 * A constant, not a row setting: the browser half would need a Schemastery schema to read the row's
 * config, and that would inline the whole library (a pure dependency, not a baseline module) into a
 * bundle that is otherwise 35 kB, for one boolean. Wrapped is the default because code lines are
 * long; sideways scrolling is the opt-out.
 */
const DEFAULT_WRAP = true

/**
 * Contribute the Changes view and the diff tab type.
 * @param ctx - client context carrying the slot registry, the locale service, and the Sidebar.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workspace-diff: dictionaries')
  // Registration-time text reads through the bound translate as a thunk, so the tab label follows
  // the active locale without re-registering.
  const t = ctx.locale.bind(NS)

  // The tab type: this plugin claims its own address space in the right Sidebar. The definition id
  // is the implementation's identity and the key its body registers under.
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    patterns: ['dsh-resource://' + TAB_KIND + '/**'],
    canOpen: (address) => parseDiffAddress(address) !== undefined,
    title: diffTitle,
  }), 'workspace-diff: diff tab type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_ID,
    locale: NS,
    inject: (): DiffTabInjected => ({
      apiFor: (sessionId) => createWorkspaceDiffApi(ctx, sessionId),
      defaultWrap: DEFAULT_WRAP,
      t: (key: WorkspaceDiffKey) => t(key),
    }),
  }, DiffTab)), 'workspace-diff: diff tab body')

  ctx.slots.inject(SLOT, () => ctx.slots.register({
    name: SLOT,
    id: ID,
    order: ORDER,
    locale: NS,
    label: () => t('view.label'),
    inject: (sessionId: SessionId): WorkspaceDiffInjected => ({
      api: createWorkspaceDiffApi(ctx, sessionId),
      openDiff: (path) => { ctx.sidebarRight.openResource(diffAddress(sessionId, path)) },
      t: (key: WorkspaceDiffKey) => t(key),
    }),
  }, WorkspaceDiffView))
}
