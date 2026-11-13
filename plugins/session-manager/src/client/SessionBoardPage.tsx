/**
 * The session board, its full-screen conversation preview, and its new-conversation overlay.
 *
 * The board is three columns over the live runtime state of every listed Session. A card opens a
 * preview *inside this page*: the native Conversation is embedded through the shared
 * `conversation.content` Factory, bound to a retained Session reference, so the composer and the
 * native question/approval takeovers travel with it. A back bar returns to the board; no Session
 * navigation happens.
 *
 * The same Factory serves the new-conversation overlay, centered on a blank Session that this page
 * created or reused; accepted prompts hand the board back without navigating either.
 * @module dsh-plugin-session-manager/client/page
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconChevronLeftOutlineRegular,
  IconCloseOutlineRegular,
  IconNewChatOutlineRegular,
  IconPinFillRegular,
  IconPinOutlineRegular,
  IconRightUpOutlineRegular,
  IconSettingsOutlineRegular,
  Menu,
  Modal,
  relativeTime,
  StateDot,
  type MenuEntry,
  type StateDotState,
  type RelativeTimeUnit,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: each carries the declaration merges for the global hooks and the `main` slot row.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import {
  BOARD_COLUMNS,
  RECENT_WINDOW_DAYS,
  deriveBoard,
  derivePinned,
  waitingCopyKey,
  withinRecent,
  type BoardColumn,
  type PinnedState,
  type SessionCard,
} from './board.ts'
import { armBackToBoard, disarmBackToBoard } from './back-to-board.ts'
import { clearLocalCompletion, localCompletionIds, subscribeLocalCompletions } from './completion-tracker.ts'
import { NewConversation } from './NewConversation.tsx'
import { NS, type SessionManagerKey } from './locales.ts'
import { currentWorkspaceId, recentWorkspaceId } from './new-conversation-target.ts'
import { recentWindowDays, setRecentWindowDays, subscribeRecentWindow } from './recent-window.ts'
import { CONVERSATION_SLOT } from './slots.ts'
import { setChooseWorkspace } from './workspace-choice.ts'
import css from './SessionBoard.module.css'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** An embedded Conversation the board shows: a preview dialog, its page, or a new conversation. */
    sessionManager: unknown
  }
}

/** The actions the board needs; the registration injects them from the client services. */
export interface SessionManagerInjected {
  /** Retain one Session for the waiting dialog; the page releases the reference when it closes. */
  readonly retainSession: (sessionId: SessionId) => SessionReference
  /**
   * Retain one blank Session as `mainView` for the new-conversation overlay.
   *
   * The native hero's Agent preset control, and the Host write behind it, only accept a blank
   * Session that is retained as the main view. The board panel stays selected, so this adds no
   * navigation; the page releases the reference with the overlay.
   */
  readonly retainMainView: (sessionId: SessionId) => SessionReference
  /** Open the real Session page, preserving the user's Conversation customizations. */
  readonly openSession: (sessionId: SessionId) => void
  /**
   * Resolve a new conversation's blank Session in one Workspace without navigating.
   *
   * The Workspace controller names the first reusable blank and the Host reuses it under its
   * recorded preset or creates another under the Host default — the same resolution the native
   * New Session action uses.
   * @param workspaceId - target Workspace.
   * @returns the catalogued Session the Host created or reused.
   */
  readonly connectWorkspace: (workspaceId: WorkspaceId) => Promise<SessionId>
  /**
   * Move the unsent draft text from one Session to another. Attachments cannot travel, so the page
   * checks {@link SessionManagerInjected.draftAttachmentCount} first.
   */
  readonly moveDraft: (from: SessionId, to: SessionId) => void
  /** Count the draft's browser attachments, which a Workspace switch must not silently drop. */
  readonly draftAttachmentCount: (sessionId: SessionId) => number
  /**
   * Pin or unpin one Session on the Host.
   *
   * The Host pin set is registry-global and shared with the native sidebar, so the board and the
   * sidebar always show the same pins and the same most-recently-pinned-first order.
   * @param sessionId - Session to change.
   * @param pinned - true to pin, false to unpin.
   */
  readonly setPinned: (sessionId: SessionId, pinned: boolean) => Promise<void>
}

/** The main slot's props, the preview child slot, the translate seat, and Session retention. */
type PageProps =
  PropsRuntime<'main'>
  & PropsRenderSlots<typeof CONVERSATION_SLOT>
  & PropsLocale<typeof NS>
  & InjectFace<SessionManagerInjected>

/** The page's translate function. */
type Translate = PageProps['t']

/** The Session currently shown in a preview surface. */
interface Preview {
  readonly card: SessionCard
  readonly reference: SessionReference
  /** Waiting keeps the native question dialog; other states use the general session preview. */
  readonly kind: 'question' | 'session'
  /** State at open, used if the dialog opens the real page. */
  readonly state: PinnedState
  /** Only the question dialog can expand to the embedded page. */
  readonly mode: 'dialog' | 'page'
}

/** The blank Session the new-conversation overlay is showing, and its two retained handles. */
interface Composer {
  /** Owns the embedded Conversation for as long as the overlay is mounted. */
  readonly reference: SessionReference
  /** Keeps the blank Session eligible for the native hero's Agent preset control. */
  readonly mainView: SessionReference
}

/** Props of the question dialog. */
interface PreviewDialogProps {
  readonly preview: Preview
  readonly title: string
  /** Current pending interaction kind; absent once the user has answered. */
  readonly waitingKind: string | undefined
  readonly t: Translate
  readonly SessionProvider: PageProps['SessionProvider']
  readonly renderSlot: PageProps['renderSlot']
  readonly onClose: () => void
  readonly onOpenPage: () => void
  readonly onOpenSession: () => void
}

/**
 * Render the waiting Session's native Conversation in a dialog.
 *
 * The native question card lives in the Conversation composer chain, so the same embedded Factory
 * that fills the dialog puts the card at the bottom. The bar names why the Session waits and offers
 * the embedded page for context.
 * @param props - the preview, copy, the bound child slot, and the two navigation callbacks.
 * @returns the dialog with the native Conversation.
 */
function PreviewDialog({
  preview,
  title,
  waitingKind,
  t,
  SessionProvider,
  renderSlot,
  onClose,
  onOpenPage,
  onOpenSession,
}: PreviewDialogProps): ReactNode {
  return (
    <Modal open onClose={onClose} title={title} headless className={css.dialog ?? ''}>
      <div className={css.dialogFrame}>
        <header className={css.dialogBar}>
          <div className={css.dialogHeading}>
            {preview.kind === 'question' && waitingKind !== undefined && (
              <span className={css.dialogEyebrow}>{t(waitingCopyKey(waitingKind))}</span>
            )}
            <span className={css.dialogTitle} title={title}>{title}</span>
          </div>
          {preview.kind === 'question'
            ? (
              <button type="button" className={css.dialogAction} onClick={onOpenPage}>
                {t('preview.openPage')}
              </button>
            )
            : (
              <button type="button" className={css.dialogAction} onClick={onOpenSession}>
                {t('preview.openSession')}
              </button>
            )}
          <button
            type="button"
            className={css.dialogClose}
            aria-label={t('preview.close')}
            title={t('preview.close')}
            onClick={onClose}
          >
            <IconCloseOutlineRegular size={14} />
          </button>
        </header>
        <div className={css.dialogBody}>
          <SessionProvider session={preview.reference}>
            {renderSlot(CONVERSATION_SLOT, {})}
          </SessionProvider>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Read marks for completions acknowledged from the board.
 *
 * DSH clears `completionUnread` only for a `mainView` retention; the board keeps its own mark so an
 * unread completion moves to **Recent** after it has been opened from the board. The value is the
 * summary `updatedAt` the card showed, so newer activity makes the completion current again.
 * Module-level so a panel round trip keeps the classification; browser-local, like DSH's reminder.
 */
const completionReadAt = new Map<SessionId, number>()

/** Per-column copy and the state dot it leads with. */
interface ColumnCopy {
  readonly title: SessionManagerKey
  readonly empty: SessionManagerKey
  readonly dot: StateDotState
}

/** Column copy, in the same order as {@link BOARD_COLUMNS}. */
const COLUMN_COPY: Record<BoardColumn, ColumnCopy> = {
  running: { title: 'column.running', empty: 'column.running.empty', dot: 'ongoing' },
  unread: { title: 'column.unread', empty: 'column.unread.empty', dot: 'warning' },
  recent: { title: 'column.recent', empty: 'column.recent.empty', dot: 'idle' },
}

/** Relative-time buckets, localized in this plugin's own dictionary. */
const TIME_COPY: Record<RelativeTimeUnit, SessionManagerKey> = {
  now: 'time.now',
  minutes: 'time.minutes',
  hours: 'time.hours',
  days: 'time.days',
  months: 'time.months',
  years: 'time.years',
}

/**
 * The trailing state label on one card.
 * @param column - the card's column.
 * @param card - the card whose waiting kind may refine the label.
 * @param t - this namespace's translate function.
 * @returns the visible state text.
 */
function stateText(state: PinnedState, card: SessionCard, t: Translate): string {
  if (state === 'waiting') return t(waitingCopyKey(card.waitingKind))
  if (state === 'running') return t('card.running')
  if (state === 'completed') return t('card.completed')
  return t('card.idle')
}

/**
 * Format the card's relative activity time with the shared bucket function.
 * @param at - epoch ms of the latest activity.
 * @param now - current epoch ms, injected so render stays pure.
 * @param t - this namespace's translate function.
 * @returns the localized relative time.
 */
function timeText(at: number, now: number, t: Translate): string {
  const bucket = relativeTime(at, now)
  return t(TIME_COPY[bucket.unit], { n: bucket.n })
}

/**
 * Basename of a POSIX or Windows working directory.
 * @param path - absolute directory path.
 * @returns the final path segment, without trailing separators.
 */
function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (trimmed === '') return path
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return at === -1 ? trimmed : trimmed.slice(at + 1)
}

/**
 * Full timestamp for a card's tooltip.
 * @param at - epoch ms.
 * @returns the reader's localized date and time.
 */
function fullDate(at: number): string {
  return new Date(at).toLocaleString()
}

/** One card's content, its state, and the pin and real-page controls. */
interface SessionCardViewProps {
  readonly card: SessionCard
  readonly state: PinnedState
  readonly pinned: boolean
  readonly pinPending: boolean
  readonly t: Translate
  readonly now: number
  readonly useSessionAccess: PageProps['useSessionAccess']
  readonly onOpen: () => void
  readonly onOpenSession: () => void
  readonly onTogglePin: () => void
}

/**
 * Render one Session card.
 *
 * The body is a button so the whole card opens the preview dialog. The pin and open-session
 * controls are sibling buttons in the corner, not nested controls. They are hidden until the card
 * is hovered or focused; the pin stays visible while the card is pinned, and only renders when the
 * Session's access snapshot allows the toggle.
 * @param props - the card, its state label, pin state, copy, clock, and three actions.
 * @returns the card.
 */
function SessionCardView({
  card,
  state,
  pinned,
  pinPending,
  t,
  now,
  useSessionAccess,
  onOpen,
  onOpenSession,
  onTogglePin,
}: SessionCardViewProps): ReactNode {
  const pinAllowed = useSessionAccess(
    card.id,
    pinned ? 'workspace/unpinSession' : 'workspace/pinSession',
  )
  return (
    <article
      className={css.card}
      data-state={state}
      data-pinned={pinned ? 'true' : undefined}
      data-open="true"
    >
      <button type="button" className={css.cardBody} onClick={onOpen}>
        <span className={css.cardTitle} title={card.title}>{card.title}</span>
        <span className={css.cardLine}>
          <span className={css.cardState}>{stateText(state, card, t)}</span>
          <span className={css.time} title={fullDate(card.updatedAt)}>
            {timeText(card.updatedAt, now, t)}
          </span>
        </span>
        {card.cwd !== undefined && (
          <span className={css.cwd} title={card.cwd}>{baseName(card.cwd)}</span>
        )}
      </button>
      <button
        type="button"
        className={css.open}
        aria-label={t('preview.openSession')}
        title={t('preview.openSession')}
        onClick={onOpenSession}
      >
        <IconRightUpOutlineRegular size={14} />
      </button>
      {pinAllowed === true && (
        <button
          type="button"
          className={css.pin}
          data-pinned={pinned ? 'true' : undefined}
          aria-label={pinned ? t('pin.remove') : t('pin.add')}
          aria-pressed={pinned}
          aria-busy={pinPending}
          title={pinned ? t('pin.remove') : t('pin.add')}
          disabled={pinPending}
          onClick={onTogglePin}
        >
          {pinned ? <IconPinFillRegular size={14} /> : <IconPinOutlineRegular size={14} />}
        </button>
      )}
    </article>
  )
}

/**
 * Render the board, the waiting dialog, or that dialog's expanded embedded page.
 * @param props - main-slot standard props, the preview child, translate seat, and retention.
 * @returns the board page or its full-screen conversation preview.
 */
export function SessionBoardPage(props: PageProps): ReactNode {
  const {
    useSessions,
    useSessionStatus,
    useWorkspaces,
    retainSession,
    retainMainView,
    openSession,
    connectWorkspace,
    moveDraft,
    draftAttachmentCount,
    setPinned,
    useSessionAccess,
    SessionProvider,
    renderSlot,
    t,
  } = props
  const list = useSessions((state) => state)
  const statuses = useSessionStatus((state) => state)
  const workspaces = useWorkspaces((state) => state)
  const archived = workspaces.archivedSessionIds
  const [now, setNow] = useState(() => Date.now())
  const [preview, setPreview] = useState<Preview | undefined>(undefined)
  const [previewError, setPreviewError] = useState<string | undefined>(undefined)
  const [composer, setComposer] = useState<Composer | undefined>(undefined)
  const [startError, setStartError] = useState<string | undefined>(undefined)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pinError, setPinError] = useState<string | undefined>(undefined)
  const [pinBusy, setPinBusy] = useState<ReadonlySet<SessionId>>(() => new Set())
  const [, bumpBoardRevision] = useState(0)
  const [, bumpWindowRevision] = useState(0)
  const opening = useRef(false)
  const switching = useRef(false)
  const pinning = useRef<Set<SessionId>>(new Set())
  const mounted = useRef(true)
  // The picker callback outlives the render that created it and must read the latest Workspace
  // registry through a ref rather than keeping a stale snapshot.
  const workspacesRef = useRef(workspaces)
  workspacesRef.current = workspaces
  const composerRef = useRef<Composer | undefined>(undefined)
  composerRef.current = composer

  // The tracker is global; this board only needs to re-render when its local completion map moves.
  useEffect(() => subscribeLocalCompletions(() => {
    bumpBoardRevision((value) => value + 1)
  }), [bumpBoardRevision])

  // The Recent window is another browser-local preference; redraw when it changes.
  useEffect(() => subscribeRecentWindow(() => {
    bumpWindowRevision((value) => value + 1)
  }), [bumpWindowRevision])

  // The board is visible, so a return marker from an earlier Session visit is stale.
  useEffect(() => {
    disarmBackToBoard()
  }, [])

  // Creating a Session is a round trip; a reference it returns after the panel is gone must not
  // leak, and a picker left mounted must stop offering a chooser for a page that no longer exists.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      setChooseWorkspace(undefined)
    }
  }, [])

  // Relative labels are the only clock-dependent copy on the page. A slow tick keeps them honest
  // without re-deriving the board, which only changes when Session state does. The tick pauses while
  // the native Conversation is mounted, so the preview is not re-rendered by an unrelated clock.
  useEffect(() => {
    if (preview !== undefined || composer !== undefined) return undefined
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 30_000)
    return () => {
      clearInterval(timer)
    }
  }, [preview, composer])

  // The preview owns one retained Session reference. Releasing it in the effect cleanup runs after
  // the Conversation for the old reference has unmounted, including when the page itself unmounts.
  const previewReference = preview?.reference
  useEffect(() => {
    if (previewReference === undefined) return
    return () => {
      previewReference.release()
    }
  }, [previewReference])

  // The overlay owns both handles; the cleanup runs after the Conversation unmounts.
  const composerReference = composer?.reference
  const composerMainView = composer?.mainView
  useEffect(() => {
    if (composerReference === undefined) return
    return () => {
      composerReference.release()
      composerMainView?.release()
    }
  }, [composerReference, composerMainView])

  const locallyCompleted = localCompletionIds(list)
  const pinned = derivePinned(list, statuses, archived, workspaces.pinnedSessionIds, completionReadAt, locallyCompleted)
  const pinnedIds = new Set(pinned.map((card) => card.id))
  const board = deriveBoard(list, statuses, archived, locallyCompleted, completionReadAt)
  const windowDays = recentWindowDays()
  const recent = withinRecent(board.recent, now, windowDays)
  const columns: Record<BoardColumn, readonly SessionCard[]> = {
    running: board.running.filter((card) => !pinnedIds.has(card.id)),
    unread: board.unread.filter((card) => !pinnedIds.has(card.id)),
    recent: recent.filter((card) => !pinnedIds.has(card.id)),
  }
  const total = columns.running.length + columns.unread.length + columns.recent.length + pinned.length
  const windowItems: MenuEntry[] = [
    { type: 'label', id: 'recent-window', text: t('settings.recent') },
    ...RECENT_WINDOW_DAYS.map((days) => ({
      id: String(days),
      label: t(days === 1 ? 'settings.day' : 'settings.days', { n: days }),
    })),
  ]

  /**
   * Open the card's preview dialog.
   *
   * A waiting card keeps the native question surface; every other state gets the general session
   * dialog. A completed card opened for viewing is acknowledged immediately.
   * @param card - the clicked card.
   * @param state - the column or pinned state that owns the card.
   */
  function openPreview(card: SessionCard, state: PinnedState): void {
    setPreviewError(undefined)
    try {
      const reference = retainSession(card.id)
      if (state === 'completed') {
        clearLocalCompletion(card.id)
        completionReadAt.set(card.id, card.updatedAt)
        bumpBoardRevision((value) => value + 1)
      }
      setPreview({
        card,
        reference,
        kind: state === 'waiting' ? 'question' : 'session',
        state,
        mode: 'dialog',
      })
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  /**
   * Open the real Session page and arm the return control.
   * @param card - the clicked card.
   * @param state - the column or pinned state that owns the card.
   * @returns whether the Session page opened.
   */
  function openSessionPage(card: SessionCard, state: PinnedState): boolean {
    setPreviewError(undefined)
    armBackToBoard()
    try {
      openSession(card.id)
    } catch (cause) {
      disarmBackToBoard()
      setPreviewError(cause instanceof Error ? cause.message : String(cause))
      return false
    }
    // The real page is now the visible conversation; a completed card has been acknowledged.
    if (state === 'completed') {
      clearLocalCompletion(card.id)
      completionReadAt.set(card.id, card.updatedAt)
    }
    return true
  }

  /** Leave the preview; its effect cleanup releases the retained reference. */
  function closePreview(): void {
    setNow(Date.now())
    setPreview(undefined)
  }

  /**
   * Start a new conversation without navigating.
   *
   * The target follows the native New Session order: the Workspace of the Session the app currently
   * shows, then the Workspace with the most recent activity. The Workspace controller resolves the
   * blank itself, so the overlay gets the same reused Session and Agent preset the main New Session
   * would.
   */
  async function startConversation(): Promise<void> {
    if (opening.current) return
    opening.current = true
    setStartError(undefined)
    try {
      const workspaceId = currentWorkspaceId(workspaces, list) ?? recentWorkspaceId(workspaces, list)
      if (workspaceId === undefined) throw new Error(t('new.failed'))
      const sessionId = await connectWorkspace(workspaceId)
      const reference = retainSession(sessionId)
      let mainView: SessionReference
      try {
        mainView = retainMainView(sessionId)
      } catch (cause) {
        reference.release()
        throw cause
      }
      if (!mounted.current) {
        reference.release()
        mainView.release()
        return
      }
      setChooseWorkspace(switchWorkspace)
      setComposer({ reference, mainView })
    } catch (cause) {
      setStartError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      opening.current = false
    }
  }

  /** Hand the screen back to the board; the release effect drops the retained references. */
  function closeConversation(): void {
    setChooseWorkspace(undefined)
    setComposer(undefined)
  }

  /**
   * Pin or unpin one Session on the Host.
   *
   * The Host snapshot is the source of truth, so the rail and the columns move on their own. The ref
   * only prevents a double click from sending pin and unpin together; a failed write is reported
   * above the columns.
   * @param sessionId - Session to change.
   * @param pinned - whether the Session is pinned now.
   */
  async function togglePin(sessionId: SessionId, pinned: boolean): Promise<void> {
    if (pinning.current.has(sessionId)) return
    pinning.current.add(sessionId)
    setPinBusy(new Set(pinning.current))
    setPinError(undefined)
    try {
      await setPinned(sessionId, !pinned)
    } catch (cause) {
      setPinError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pinning.current.delete(sessionId)
      setPinBusy(new Set(pinning.current))
    }
  }

  /**
   * Move the open new conversation to another Workspace without leaving the overlay.
   *
   * There is no Host command that re-homes a Session, so the move is a swap: connect a blank Session
   * in the target Workspace through the same resolution the native Workspace picker uses (its own
   * Agent preset or the Host default), then carry the draft text over. Attachments cannot travel
   * between input shells, so a draft that has any refuses the switch instead of dropping them.
   * @param fromId - the blank Session the overlay is showing.
   * @param workspaceId - the Workspace the user picked.
   * @returns a localized failure, or undefined after the overlay moved.
   */
  async function switchWorkspace(
    fromId: SessionId,
    workspaceId: WorkspaceId,
  ): Promise<string | undefined> {
    const current = composerRef.current
    if (current === undefined || current.reference.sessionId !== fromId) return undefined
    const owner = workspacesRef.current.items.find((workspace) => workspace.sessionIds.includes(fromId))
    if (owner?.workspaceId === workspaceId) return undefined
    if (switching.current) return undefined
    switching.current = true
    try {
      if (draftAttachmentCount(fromId) > 0) return t('workspace.attachments')
      const sessionId = await connectWorkspace(workspaceId)
      // A lagging client snapshot can make the Host reuse the very Session being shown; there is
      // nothing to move in that case.
      if (sessionId === fromId) return undefined
      const reference = retainSession(sessionId)
      let mainView: SessionReference
      try {
        mainView = retainMainView(sessionId)
      } catch (cause) {
        reference.release()
        throw cause
      }
      try {
        moveDraft(fromId, sessionId)
      } catch (cause) {
        reference.release()
        mainView.release()
        throw cause
      }
      setComposer({ reference, mainView })
      return undefined
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    } finally {
      switching.current = false
    }
  }

  /**
   * Open the real page from the preview dialog, closing the dialog if navigation fails so the error
   * is visible on the board.
   * @param current - the dialog's preview.
   */
  function openRealPage(current: Preview): void {
    if (openSessionPage(current.card, current.state)) return
    setPreview(undefined)
  }

  /** Keep the retained Session and expand the question dialog into the embedded page. */
  function openPage(): void {
    setPreview((current) => current === undefined || current.kind !== 'question'
      ? current
      : { ...current, mode: 'page' })
  }

  const previewTitle = preview === undefined
    ? ''
    : list.byId[preview.card.id]?.displayTitle ?? preview.card.title

  if (preview !== undefined && preview.kind === 'question' && preview.mode === 'page') {
    return (
      <div className={css.preview}>
        <header className={css.previewBar}>
          <button
            type="button"
            className={css.back}
            aria-label={t('preview.back')}
            title={t('preview.back')}
            onClick={closePreview}
          >
            <IconChevronLeftOutlineRegular size={16} />
            <span>{t('preview.back')}</span>
          </button>
          <span className={css.previewTitle} title={previewTitle}>{previewTitle}</span>
        </header>
        <div className={css.previewBody}>
          <SessionProvider session={preview.reference}>
            {renderSlot(CONVERSATION_SLOT, {})}
          </SessionProvider>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={css.page}>
      <div className={css.content}>
        <header className={css.header}>
          <h1 className={css.title}>{t('page.title')}</h1>
          <div className={css.headerTools}>
            {total > 0 && <span className={css.total}>{t('page.count', { count: total })}</span>}
            <button
              type="button"
              className={css.newChat}
              aria-label={t('new.title')}
              title={t('new.title')}
              onClick={() => {
                void startConversation()
              }}
            >
              <IconNewChatOutlineRegular size={16} />
            </button>
            <Menu
              open={settingsOpen}
              anchor={(
                <button
                  type="button"
                  className={css.settings}
                  aria-label={t('settings.open')}
                  aria-haspopup="menu"
                  aria-expanded={settingsOpen}
                  title={t('settings.open')}
                  onClick={() => {
                    setSettingsOpen((open) => !open)
                  }}
                >
                  <IconSettingsOutlineRegular size={16} />
                </button>
              )}
              items={windowItems}
              selectedId={String(windowDays)}
              onSelect={(id) => {
                setRecentWindowDays(Number(id))
                setSettingsOpen(false)
              }}
              onClose={() => {
                setSettingsOpen(false)
              }}
              align="end"
              side="bottom"
              autoFocus
              portal
              className={css.settingsAnchor}
            />
          </div>
        </header>

        {previewError !== undefined && (
          <p className={css.previewError} role="alert">
            {t('preview.failed')}: {previewError}
          </p>
        )}

        {startError !== undefined && (
          <p className={css.previewError} role="alert">
            {t('new.failed')}: {startError}
          </p>
        )}

        {pinError !== undefined && (
          <p className={css.previewError} role="alert">
            {t('pin.failed')}: {pinError}
          </p>
        )}

        {total === 0 && list.phase === 'pending' && (
          <p className={css.loading} role="status">{t('state.loading')}</p>
        )}

        {pinned.length > 0 && (
          <section className={css.pinned} aria-labelledby="session-manager-pinned">
            <header className={css.pinnedHead}>
              <IconPinFillRegular size={14} />
              <h2 className={css.pinnedTitle} id="session-manager-pinned">{t('pinned.title')}</h2>
              <span className={css.columnCount}>{pinned.length}</span>
            </header>
            <ul className={css.pinnedRail}>
              {pinned.map((card) => (
                <li className={css.pinnedItem} key={card.id}>
                  <SessionCardView
                    card={card}
                    state={card.state}
                    pinned
                    pinPending={pinBusy.has(card.id)}
                    t={t}
                    now={now}
                    useSessionAccess={useSessionAccess}
                    onOpen={() => {
                      openPreview(card, card.state)
                    }}
                    onOpenSession={() => {
                      openSessionPage(card, card.state)
                    }}
                    onTogglePin={() => {
                      void togglePin(card.id, true)
                    }}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {(total > 0 || list.phase === 'ready') && (
          <div className={css.board}>
            {BOARD_COLUMNS.map((column) => {
              const cards = columns[column]
              const meta = COLUMN_COPY[column]
              return (
                <section
                  className={css.column}
                  key={column}
                  data-column={column}
                  aria-labelledby={`session-manager-${column}`}
                >
                  <header className={css.columnHead}>
                    {column === 'running'
                      ? <StateDot state="done" className={css.runningDot} />
                      : <StateDot state={meta.dot} />}
                    <h2 className={css.columnTitle} id={`session-manager-${column}`}>{t(meta.title)}</h2>
                    <span className={css.columnCount}>{cards.length}</span>
                  </header>
                  {cards.length === 0
                    ? <p className={css.columnEmpty}>{t(meta.empty)}</p>
                    : (
                      <ul className={css.cards}>
                        {cards.map((card) => {
                          const state: PinnedState = column === 'running'
                            ? 'running'
                            : column === 'unread'
                              ? statuses.get(card.id)?.pendingInteraction !== undefined
                                ? 'waiting'
                                : 'completed'
                              : 'idle'
                          return (
                            <li key={card.id}>
                              <SessionCardView
                                card={card}
                                state={state}
                                pinned={false}
                                pinPending={pinBusy.has(card.id)}
                                t={t}
                                now={now}
                                useSessionAccess={useSessionAccess}
                                onOpen={() => {
                                  openPreview(card, state)
                                }}
                                onOpenSession={() => {
                                  openSessionPage(card, state)
                                }}
                                onTogglePin={() => {
                                  void togglePin(card.id, false)
                                }}
                              />
                            </li>
                          )
                        })}
                      </ul>
                    )}
                </section>
              )
            })}
          </div>
        )}
        </div>
      </div>
      {preview !== undefined && preview.mode === 'dialog' && (
        <PreviewDialog
          preview={preview}
          title={previewTitle}
          waitingKind={statuses.get(preview.card.id)?.pendingInteraction?.kind}
          t={t}
          SessionProvider={SessionProvider}
          renderSlot={renderSlot}
          onClose={closePreview}
          onOpenPage={openPage}
          onOpenSession={() => {
            openRealPage(preview)
          }}
        />
      )}
      {composer !== undefined && (
        <NewConversation
          reference={composer.reference}
          t={t}
          renderSlot={renderSlot}
          SessionProvider={SessionProvider}
          onSent={closeConversation}
          onClose={closeConversation}
        />
      )}
    </>
  )
}
