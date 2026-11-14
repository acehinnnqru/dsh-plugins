/**
 * `dsh-plugin-session-manager`, browser half.
 *
 * One panel, five registrations: the sidebar row that launches it, the page itself in the main
 * column, the session-scoped host for the board's embedded Conversations, the searchable Workspace
 * picker in the native hero's options row, and the leading control that returns to the board. The
 * page and the sidebar row share the same id because the sidebar resolves a panel row by selecting
 * the main key of the same name.
 *
 * Only values from DSH baseline modules may be imported; every cross-package import below is
 * type-only and exists for its declaration merge. The bundle build refuses the alternative on
 * purpose.
 * @module dsh-plugin-session-manager/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConfigForm, ConfigForms } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: they carry the declaration merges for ctx.locale, ctx.slots, ctx.sessions,
// ctx.uiWorkspace, and the 'main' / 'sidebar.panellist' SlotMap rows.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { BackToBoard } from './BackToBoard.tsx'
import { disarmBackToBoard } from './back-to-board.ts'
import { localCompletionIds, startCompletionTracker, subscribeLocalCompletions } from './completion-tracker.ts'
import { SharedStatusStore } from './status.ts'
import { SessionConversationHost } from './ConversationHost.tsx'
import { SessionBoardPage, type SessionManagerInjected } from './SessionBoardPage.tsx'
import { SessionManagerIcon } from './SessionManagerIcon.tsx'
import { mergeWorkspaceMembers, remoteSessionsByPath } from './workspace-membership.ts'
import { WorkspacePicker } from './WorkspacePicker.tsx'
import { en, NS, zh } from './locales.ts'
import type { PreviewDestination } from './preview-links.ts'
import {
  fileAddress,
  replayChangesReview,
  whenRightColumnMounts,
  type RightColumn,
} from './right-column.ts'
import { CONVERSATION_SLOT } from './slots.ts'
import { SETTINGS_ENTRY, type SessionManagerSettings } from './settings.ts'

/** The panel's id: the main column's key and the sidebar row's list id have to be the same value. */
const PANEL_ID = 'session-manager' as MainPanelId

/** After the shipped Plugins row (0), Automation tasks row (10), and the other plugin panels. */
const PANEL_ORDER = 30

/** Cordis service names this half waits for: slots, locale, Session retention, Session status, and navigation. */
export const inject = ['slots', 'locale', 'sessions', 'workspaces', 'uiSession', 'uiWorkspace', 'layout', 'remote', 'remote.settings']

/** The Chat view's settings form, read for the one value that decides where a web link opens. */
interface ChatSettingsForm {
  getSnapshot(): { readonly value?: { readonly linkOpening?: string } }
}

/** The settings registry, reached through `ctx.get` because this plugin does not require it. */
interface ConfigFormsFace {
  get(namespace: string): ChatSettingsForm | undefined
}

/** The Client Workspace projection this plugin augments with remote members. */
interface WorkspaceStoreFace {
  readonly list: {
    getSnapshot(): {
      readonly items: readonly WorkspaceView[]
      readonly phase: 'pending' | 'ready'
    }
    subscribe(listener: () => void): () => void
  }
  readonly model?: {
    upsertView(view: WorkspaceView): void
  }
}

/** Whether two Session id lists are already identical. */
function sameIds(left: readonly SessionId[], right: readonly SessionId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/**
 * Whether a web link belongs in the right column instead of a new browser tab.
 *
 * The Chat view owns this preference and defaults to the column. A build without the column's
 * browser page, or without the setting, opens the link in the browser, which is also the product's
 * fallback.
 * @param ctx - client context carrying the two optional services.
 * @returns true when the column should take the link.
 */
function linksOpenInColumn(ctx: ClientContext): boolean {
  if (ctx.get('sidebarRightTabs')?.get('browser') === undefined) return false
  try {
    const form = (ctx.get('configForms') as ConfigFormsFace | undefined)?.get('ui-chat')
    return form?.getSnapshot().value?.linkOpening !== 'new-tab'
  } catch {
    return true
  }
}

/**
 * Contribute the board page, its preview child, and its sidebar row.
 * @param ctx - client context carrying the slot registry, locale, and Session service.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-manager: dictionaries')
  const t = ctx.locale.bind(NS)
  const settings = (): ConfigForm<SessionManagerSettings> | undefined => {
    if (typeof ctx.get !== 'function') return undefined
    try {
      return (ctx.get('configForms') as ConfigForms | undefined)?.get<SessionManagerSettings>(SETTINGS_ENTRY)
    } catch {
      return undefined
    }
  }
  const saveSettings = async (
    section: SessionManagerSettings,
    revision: number | undefined,
  ): Promise<{ readonly ok: boolean; readonly message?: string }> => {
    if (typeof ctx.get !== 'function') return { ok: false, message: 'Settings service is unavailable.' }
    const remote = ctx.get('remote') as {
      readonly settings?: {
        replace: (ns: string, value: Record<string, unknown>, expectedRevision: number | undefined) => Promise<{
          readonly ok: boolean
          readonly error?: { readonly message?: string }
        }>
      }
    } | undefined
    if (remote?.settings === undefined) return { ok: false, message: 'Settings service is unavailable.' }
    try {
      const result = await remote.settings.replace(SETTINGS_ENTRY, { ...section }, revision)
      return result.ok ? { ok: true } : { ok: false, message: result.error?.message ?? 'Host refused the settings write.' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  startCompletionTracker(ctx)
  const sharedStatus = new SharedStatusStore()
  ctx.effect(() => {
    if (typeof window === 'undefined') return () => {}
    sharedStatus.start()
    return () => sharedStatus.stop()
  }, 'session-manager: shared status polling')

  // The native new-session shell only enables the composer when the Session belongs to a
  // Workspace in this browser's projection. A peer's Session is not in the Host registry, so add
  // it to the matching local Workspace view (and remove it when the peer row disappears).
  ctx.effect(() => {
    const workspaces = typeof ctx.get === 'function'
      ? ctx.get('workspaces') as WorkspaceStoreFace | undefined
      : undefined
    const model = workspaces?.model
    if (workspaces === undefined || model === undefined || typeof model.upsertView !== 'function') return () => {}
    const patched = new Map<string, Set<SessionId>>()
    let syncing = false

    const sync = (): void => {
      if (syncing) return
      syncing = true
      try {
        const state = workspaces.list.getSnapshot()
        if (state.phase !== 'ready') return
      const remoteByPath = remoteSessionsByPath(ctx.sessions.list.getSnapshot())
      const live = new Set<string>()
      for (const view of state.items) {
        live.add(view.workspaceId)
        const desired = remoteByPath.get(view.path) ?? []
        const previous = patched.get(view.workspaceId) ?? new Set<SessionId>()
        const next = mergeWorkspaceMembers(view.sessionIds, previous, desired)
        patched.set(view.workspaceId, new Set(desired))
        if (!sameIds(view.sessionIds, next)) model.upsertView({ ...view, sessionIds: next })
        }
        for (const id of patched.keys()) if (!live.has(id)) patched.delete(id)
      } finally {
        syncing = false
      }
    }

    sync()
    const stopSessions = ctx.sessions.list.subscribe(sync)
    const stopWorkspaces = workspaces.list.subscribe(sync)
    return () => {
      stopSessions()
      stopWorkspaces()
      const state = workspaces.list.getSnapshot()
      for (const [workspaceId, ids] of patched) {
        const view = state.items.find((item) => item.workspaceId === workspaceId)
        if (view === undefined) continue
        const next = view.sessionIds.filter((id) => !ids.has(id))
        if (!sameIds(view.sessionIds, next)) model.upsertView({ ...view, sessionIds: next })
      }
    }
  }, 'session-manager: remote workspace membership')

  // Import an unread completion the native UI already holds, even when the board panel is not open.
  ctx.effect(() => {
    let unread = new Set<string>()
    const report = (): void => {
      const statuses = ctx.uiSession.sessionStatus.getSnapshot()
      const list = ctx.sessions.list.getSnapshot()
      const current = new Set<string>()
      for (const [id, status] of statuses) {
        if (!status.completionUnread) continue
        current.add(id)
        const row = list.byId[id]
        if (row !== undefined) void sharedStatus.report(id, row.updatedAt)
      }
      for (const id of localCompletionIds(list)) {
        current.add(id)
        const row = list.byId[id]
        if (row !== undefined) void sharedStatus.report(id, row.updatedAt)
      }
      // Opening the native page or clearing a local stop is a read; publish it too.
      for (const id of unread) if (!current.has(id)) void sharedStatus.read(id)
      unread = current
    }
    report()
    const disposeStatus = ctx.uiSession.sessionStatus.subscribe(report)
    const disposeList = ctx.sessions.list.subscribe(report)
    const disposeLocal = subscribeLocalCompletions(report)
    return () => {
      disposeStatus()
      disposeList()
      disposeLocal()
    }
  }, 'session-manager: unread import')

  // Keep the Host list current while the client is open; remote rows and their state arrive through
  // the federated list, not through a Host push.
  ctx.effect(() => {
    if (typeof ctx.sessions.refresh !== 'function') return () => {}
    const timer = setInterval(() => {
      void ctx.sessions.refresh().catch(() => {})
    }, 5000)
    return () => {
      clearInterval(timer)
    }
  }, 'session-manager: remote list refresh')

  // A global panel is not the Session page; a marker left by an earlier board visit is stale.
  ctx.effect(() => ctx.layout.panelInfo.subscribe(() => {
    if (ctx.layout.panelInfo.getSnapshot().activePanelId !== null) disarmBackToBoard()
  }), 'session-manager: back marker')

  const retainSession = (sessionId: SessionId): SessionReference =>
    ctx.sessions.retain(sessionId, { source: 'sessionManager' })
  // The native hero's Agent preset control only works on a blank Session retained as the main view.
  // The board stays the selected panel, so this adds no navigation; the page releases it with the
  // overlay. It is deliberately separate from the Session's own lifecycle reference above.
  const retainMainView = (sessionId: SessionId): SessionReference =>
    ctx.sessions.retain(sessionId, { source: 'mainView' })
  const openSession = (sessionId: SessionId): void => {
    ctx.uiWorkspace.openSession(sessionId)
  }
  const connectWorkspace = (workspaceId: WorkspaceId, agentPreset?: string): Promise<SessionId> =>
    ctx.uiWorkspace.connectWorkspace(workspaceId, agentPreset === undefined ? undefined : { agentPreset })
  const waitForSession = (sessionId: SessionId): Promise<void> => new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let poll: ReturnType<typeof setInterval> | undefined
    let unsubscribe = (): void => {}
    const stop = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      if (poll !== undefined) clearInterval(poll)
      unsubscribe()
    }
    const check = (): void => {
      if (ctx.sessions.list.getSnapshot().byId[sessionId] === undefined) return
      stop()
      resolve()
    }
    unsubscribe = ctx.sessions.list.subscribe(check)
    timer = setTimeout(() => {
      stop()
      reject(new Error('Session did not reach the federated list.'))
    }, 10_000)
    poll = setInterval(() => {
      void ctx.sessions.refresh().catch(() => {})
    }, 100)
    check()
    void ctx.sessions.refresh().catch(() => {})
  })
  const createRemoteSession = async (
    nodeId: string,
    request: { readonly cwd: string; readonly agentPreset?: string },
  ): Promise<SessionId> => {
    const response = await fetch('/api/session-manager/new', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, ...request }),
    })
    const value = await response.json() as { readonly sessionId?: unknown; readonly error?: unknown }
    if (!response.ok || typeof value.sessionId !== 'string') {
      throw new Error(typeof value.error === 'string' ? value.error : 'session/create-failed')
    }
    return value.sessionId as SessionId
  }
  const inputFor = (sessionId: SessionId) => {
    try {
      const conversation = ctx.get('conversation')
      const scope = ctx.sessions.scope(sessionId)
      if (conversation === undefined || scope === undefined) return undefined
      return conversation.input.for(scope)
    } catch {
      return undefined
    }
  }
  // Moving a draft across Sessions is a browser-local operation: the input shell owns both the text
  // and the attachment ids. Text travels; attachments stay with the Session they were added to,
  // which is why the page refuses a Workspace switch while the draft has any.
  const moveDraft = (from: SessionId, to: SessionId): void => {
    if (from === to) return
    const source = inputFor(from)
    const target = inputFor(to)
    if (source === undefined || target === undefined) return
    const draft = source.state.getSnapshot().draft
    if (draft === '') return
    target.setDraft(draft)
    source.setDraft('')
  }
  const draftAttachmentCount = (sessionId: SessionId): number =>
    inputFor(sessionId)?.state.getSnapshot().attachmentIds.length ?? 0
  const setPinned = (sessionId: SessionId, pinned: boolean): Promise<void> =>
    pinned ? ctx.uiWorkspace.pinSession(sessionId) : ctx.uiWorkspace.unpinSession(sessionId)
  // The management tab batches this command; the Host refuses a Session whose work still runs.
  const archiveSession = (sessionId: SessionId): Promise<void> =>
    ctx.uiWorkspace.archiveSession(sessionId)
  /**
   * Open a destination an embedded Conversation cannot serve, on the real Session page.
   *
   * The click that asked for it navigated there, so the column mounts a moment later. A change
   * review reopens through the page's own changed-files card, whose handler holds the turn's
   * coordinates. A build without the column keeps the navigation alone; a web link the column
   * cannot take falls back to a new browser tab, the product's own fallback.
   * @param sessionId - the Session whose page opens the destination.
   * @param destination - the file, web address, or change review the click named.
   */
  const openPreviewDestination = (
    sessionId: SessionId,
    destination: PreviewDestination,
  ): void => {
    if (destination.kind === 'changes') {
      // The review's own handler holds the turn's coordinates, so the page's card opens it.
      replayChangesReview(destination.turn, destination.control)
      return
    }
    // Another plugin's service: optional, so the board keeps working without it.
    const right = ctx.get('sidebarRight') as RightColumn | undefined
    if (destination.kind === 'file') {
      if (right === undefined) return
      whenRightColumnMounts(() => {
        right.openResource(fileAddress(sessionId, destination.path))
      })
      return
    }
    if (right === undefined || !linksOpenInColumn(ctx)) {
      window.open(destination.url, '_blank', 'noopener,noreferrer')
      return
    }
    whenRightColumnMounts(() => {
      right.openTab('browser', { params: { url: destination.url } })
    })
  }

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    children: {
      [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' },
    },
    inject: (): SessionManagerInjected => ({
      retainSession,
      retainMainView,
      openSession,
      connectWorkspace,
      waitForSession,
      createRemoteSession,
      moveDraft,
      draftAttachmentCount,
      setPinned,
      archiveSession,
      openPreviewDestination,
      settings,
      saveSettings,
      sharedStatus,
    }),
  }, SessionBoardPage))

  // The page declares the child slot above; waiting for its declaration lets the host register in
  // either plugin order without touching a slot that does not exist yet.
  ctx.slots.inject(CONVERSATION_SLOT, () => ctx.slots.register({
    name: CONVERSATION_SLOT,
    locale: NS,
  }, SessionConversationHost))

  // The native hero renders the options row after the Workspace and Agent preset controls. The
  // picker claims a seat there and renders nothing outside the overlay, so the main new-session page
  // keeps its native Workspace chip.
  ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
    name: 'conversation.hero.options',
    id: 'session-manager-workspace',
    order: -10,
    locale: NS,
  }, WorkspacePicker))

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
