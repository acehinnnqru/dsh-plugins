/**
 * The session board, its management tab, its full-list session search, its full-screen conversation
 * preview, and its new-conversation overlay.
 *
 * The page header selects between **Board**, three columns over the live runtime state of every
 * listed Session, and **Management**, a selectable list for batch archiving. A card or a management
 * row opens a preview *inside this page*: the native Conversation is embedded through the shared
 * `conversation.content` Factory, bound to a retained Session reference, so the composer and the
 * native question/approval takeovers travel with it. A back bar returns to the board; no Session
 * navigation happens.
 *
 * The embedded Conversation has no right Sidebar, which is where the product opens a file
 * reference or an external page. Both preview surfaces therefore send such a click to the real
 * Session page and open the destination in that page's column, so one click has the response it
 * has everywhere else.
 *
 * The same Factory serves the new-conversation overlay, centered on a blank Session that this page
 * created or reused; accepted prompts hand the board back without navigating either.
 * @module dsh-plugin-session-manager/client/page
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconArchiveOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconCloseOutlineRegular,
  IconNewChatOutlineRegular,
  IconPinFillRegular,
  IconPinOutlineRegular,
  IconRightUpOutlineRegular,
  IconSearchOutlineRegular,
  IconSettingsOutlineRegular,
  Input,
  Modal,
  SegmentedControl,
  StateDot,
  TextShimmer,
  type SegmentedControlOption,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionListState, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: each carries the declaration merges for the global hooks and the `main` slot row.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import {
  BOARD_COLUMNS,
  deriveBoard,
  deriveNodeColumns,
  derivePinned,
  previewReadMark,
  sessionNodeOf,
  sessionDisplayTitle,
  waitingCopyKey,
  withinRecent,
  type BoardColumn,
  type NodeColumn,
  type PinnedCard,
  type PinnedState,
  type SessionCard,
} from './board.ts'
import { armBackToBoard, disarmBackToBoard } from './back-to-board.ts'
import { clearLocalCompletion, localCompletionIds, subscribeLocalCompletions } from './completion-tracker.ts'
import { REMOTE_PIN_KEY, readRemotePins, toggleRemotePin, writeRemotePins } from './remote-pins.ts'
import { matchSessions, searchableSessions, type SessionHit } from './session-search.ts'
import { workspaceOf } from './workspace-search.ts'
import { fullDate, stateText, timeText, workspaceName, type Translate } from './session-view.ts'
import { Management } from './Management.tsx'
import { NewConversation } from './NewConversation.tsx'
import { handsOffToSessionPage, previewDestination, type PreviewDestination } from './preview-links.ts'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SettingsDialog } from './SettingsDialog.tsx'
import type { SessionManagerSettings } from './settings.ts'
import type { SharedStatusStore } from './status.ts'
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
   * The Workspace controller names the first reusable blank and the Host reuses it under the
   * requested preset or its default — the same resolution the native New Session action uses.
   * @param workspaceId - target Workspace.
   * @param agentPreset - Agent preset the reused or created blank runs; the Host default when absent.
   * @returns the catalogued Session the Host created or reused.
   */
  readonly connectWorkspace: (workspaceId: WorkspaceId, agentPreset?: string) => Promise<SessionId>
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
  /**
   * Archive one Session from the registry-global archive set.
   *
   * The management tab calls this once per selected Session. The Host refuses a Session whose work
   * is still running rather than stopping it, so the tab reports those refusals and leaves the rows
   * listed.
   * @param sessionId - Session to archive.
   */
  readonly archiveSession: (sessionId: SessionId) => Promise<void>
  /**
   * Open a destination an embedded Conversation cannot serve, on the real Session page.
   *
   * The click that asks for one navigates to that page first; this command opens the destination
   * once the page can serve it.
   * @param sessionId - the Session whose page opens the destination.
   * @param destination - the file, web address, or change review the click named.
   */
  readonly openPreviewDestination: (sessionId: SessionId, destination: PreviewDestination) => void
  /** Resolve the live Host configuration form; the settings service may load after this page. */
  readonly settings: () => ConfigForm<SessionManagerSettings> | undefined
  /** Replace the plugin's live config section and return a Host failure message when refused. */
  readonly saveSettings: (
    section: SessionManagerSettings,
    revision: number | undefined,
  ) => Promise<{ readonly ok: boolean; readonly message?: string }>
  /** Shared read/unread and running status mirrored from the Host. */
  readonly sharedStatus: SharedStatusStore
}

/** The main slot's props, the preview child slot, the translate seat, and Session retention. */
type PageProps =
  PropsRuntime<'main'>
  & PropsRenderSlots<typeof CONVERSATION_SLOT>
  & PropsLocale<typeof NS>
  & InjectFace<SessionManagerInjected>

/** The page's three tabs: the board, per-node columns, and the management list. */
type PageTab = 'board' | 'nodes' | 'management'

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

/** Optional Workspace and Agent preset for the next new-conversation overlay. */
interface ConversationTarget {
  readonly workspaceId?: WorkspaceId
  readonly agentPreset?: string
}

/** Props of the question dialog. */
interface PreviewDialogProps {
  readonly preview: Preview
  readonly title: string
  /** Workspace and last-activity hint under the title. */
  readonly subtitle: string
  /** Current pending interaction kind; absent once the user has answered. */
  readonly waitingKind: string | undefined
  readonly t: Translate
  readonly SessionProvider: PageProps['SessionProvider']
  readonly renderSlot: PageProps['renderSlot']
  /** Archive one Session on the Host; a refused archive leaves the Session as it was. */
  readonly archiveSession: (sessionId: SessionId) => Promise<void>
  /** Whether the current Peer may call the archive command on the previewed Session. */
  readonly useSessionAccess: PageProps['useSessionAccess']
  readonly onClose: () => void
  readonly onOpenPage: () => void
  readonly onOpenSession: () => void
  /** Open a destination the embedded Conversation cannot serve, through the real Session page. */
  readonly onOpenDestination: (destination: PreviewDestination | undefined) => void
  /** Start the board's new-conversation overlay in the previewed Session's context. */
  readonly onNewSession: () => void
}

/**
 * Render the waiting Session's native Conversation in a dialog.
 *
 * The native question card lives in the Conversation composer chain, so the same embedded Factory
 * that fills the dialog puts the card at the bottom. The bar names why the Session waits and offers
 * the embedded page for context.
 *
 * The bar also carries the archive control, left of the new-conversation control. Archiving from
 * here is the same Host command the sidebar and the management tab use: it succeeds and hands the
 * board back, or the Host refuses a Session whose work still runs and the refusal is reported above
 * the Conversation, with the dialog left open.
 *
 * A click on a file reference or a web link leaves the dialog for the real Session page, which is
 * the only surface with the right Sidebar those destinations open in; the destination opens there
 * in the same click.
 * @param props - the preview, copy, the bound child slot, the two navigation callbacks, and the
 *   archive command with the access Hook that gates it.
 * @returns the dialog with the native Conversation.
 */
function PreviewDialog({
  preview,
  title,
  subtitle,
  waitingKind,
  t,
  SessionProvider,
  renderSlot,
  archiveSession,
  useSessionAccess,
  onClose,
  onOpenPage,
  onOpenSession,
  onOpenDestination,
  onNewSession,
}: PreviewDialogProps): ReactNode {
  const canArchive = useSessionAccess(preview.card.id, 'workspace/archiveSession')
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveError, setArchiveError] = useState<string | undefined>(undefined)
  const archiving = useRef(false)

  // The conversation's hover previews are portaled to the body below this dialog's mask; the body
  // marker lifts them for as long as the dialog is up, so a file row still previews its diff here.
  useEffect(() => {
    document.body.dataset.sessionManagerPreview = ''
    return () => {
      delete document.body.dataset.sessionManagerPreview
    }
  }, [])

  /**
   * Archive the previewed Session, then hand the board back.
   *
   * A refusal is reported in place: the Session still runs, so the conversation stays on screen
   * instead of disappearing under a closed dialog.
   */
  async function archive(): Promise<void> {
    // A double click must not send the command twice; the state flag only governs the UI.
    if (archiving.current) return
    archiving.current = true
    setArchiveBusy(true)
    setArchiveError(undefined)
    try {
      await archiveSession(preview.card.id)
    } catch (cause) {
      setArchiveError(cause instanceof Error ? cause.message : String(cause))
      setArchiveBusy(false)
      archiving.current = false
      return
    }
    // The archived Session leaves every board column, so the preview has nothing left to show.
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={title} headless className={css.dialog ?? ''}>
      <div className={css.dialogFrame}>
        <header className={css.dialogBar}>
          <div className={css.dialogHeading}>
            <div className={css.dialogTitleRow}>
              {preview.kind === 'question' && waitingKind !== undefined && (
                <span className={css.dialogEyebrow}>{t(waitingCopyKey(waitingKind))}</span>
              )}
              <span className={css.dialogTitle} title={title}>{title}</span>
            </div>
            {subtitle !== '' && (
              <span className={css.dialogSubtitle} title={subtitle}>{subtitle}</span>
            )}
          </div>
          {canArchive && (
            <button
              type="button"
              className={css.dialogIconAction}
              aria-label={t('preview.archive')}
              title={t('preview.archive')}
              aria-busy={archiveBusy}
              disabled={archiveBusy}
              onClick={() => {
                void archive()
              }}
            >
              <IconArchiveOutlineRegular size={16} />
            </button>
          )}
          <button
            type="button"
            className={css.dialogIconAction}
            aria-label={t('new.title')}
            title={t('new.title')}
            onClick={onNewSession}
          >
            <IconNewChatOutlineRegular size={16} />
          </button>
          {preview.kind === 'question'
            ? (
              <button type="button" className={css.dialogAction} onClick={onOpenPage}>
                {t('preview.openPage')}
              </button>
            )
            : (
              <button
                type="button"
                className={css.dialogIconAction}
                aria-label={t('preview.openSession')}
                title={t('preview.openSession')}
                onClick={onOpenSession}
              >
                <IconRightUpOutlineRegular size={14} />
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
        {archiveError !== undefined && (
          <p className={css.dialogError} role="alert">
            {t('preview.archiveFailed')}: {archiveError}
          </p>
        )}
        {/* A file or web link has no right Sidebar to open in here; the real page does. */}
        <div
          className={css.dialogBody}
          onClickCapture={(event) => {
            if (!handsOffToSessionPage(event)) return
            event.preventDefault()
            event.stopPropagation()
            onOpenDestination(previewDestination(event))
          }}
        >
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

/**
 * Read the Agent preset a Session runs from the list projection.
 *
 * The projection is declared by the product's agent-preset plugin, which is not a dependency of
 * this one; read the id from the summary's opaque projection bag.
 * @param list - Session list snapshot.
 * @param sessionId - Session to inspect.
 * @returns the preset id, or undefined when the projection is absent or empty.
 */
function sessionPreset(list: SessionListState, sessionId: SessionId): string | undefined {
  const values = list.byId[sessionId]?.projectionValues as Record<string, unknown> | undefined
  const listed = values?.['agentPreset']
  return typeof listed === 'string' && listed !== '' ? listed : undefined
}

/** One card's content, its state, and the pin and real-page controls. */
interface SessionCardViewProps {
  readonly card: SessionCard
  readonly state: PinnedState
  readonly pinned: boolean
  readonly pinPending: boolean
  /** Workspace label shown after the node badge. */
  readonly workspace: string
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
  workspace,
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
  const nodeLabel = card.node.self ? 'self' : card.node.name
  const nodeTitle = card.node.self || card.node.instanceId === undefined
    ? nodeLabel
    : nodeLabel + ' · ' + card.node.instanceId
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
          <span className={css.cardState}>
            {state === 'running'
              ? <TextShimmer active>{stateText(state, card, t)}</TextShimmer>
              : stateText(state, card, t)}
          </span>
          <span className={css.time} title={fullDate(card.updatedAt)}>
            {timeText(card.updatedAt, now, t)}
          </span>
        </span>
        <span className={css.cardMeta}>
          <span
            className={css.cardNode}
            data-self={card.node.self ? 'true' : undefined}
            title={nodeTitle}
          >
            {nodeLabel}
          </span>
          {workspace !== '' && (
            <span className={css.cwd} title={card.cwd ?? workspace}>{workspace}</span>
          )}
        </span>
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

/** Props of the Nodes tab. */
interface NodesBoardProps {
  readonly columns: readonly NodeColumn[]
  readonly pinBusy: ReadonlySet<SessionId>
  readonly workspaces: readonly WorkspaceView[]
  readonly t: Translate
  readonly now: number
  readonly useSessionAccess: PageProps['useSessionAccess']
  readonly onOpen: (card: PinnedCard) => void
  readonly onOpenSession: (card: PinnedCard) => void
  readonly onTogglePin: (card: PinnedCard, pinned: boolean) => void
}

/**
 * Render one vertical column per node.
 *
 * Pinned Sessions head each node column; the rest follow newest first. Up to three columns share the
 * width; more nodes keep their columns and scroll horizontally.
 * @param props - node columns, pin state, copy, clock, and the card actions.
 * @returns the Nodes tab, or its empty state.
 */
function NodesBoard({
  columns,
  pinBusy,
  workspaces,
  t,
  now,
  useSessionAccess,
  onOpen,
  onOpenSession,
  onTogglePin,
}: NodesBoardProps): ReactNode {
  if (columns.length === 0) return <p className={css.columnEmpty}>{t('nodes.empty')}</p>
  const template = columns.length <= 3
    ? `repeat(${columns.length}, minmax(0, 1fr))`
    : `repeat(${columns.length}, calc((100% - 24px) / 3))`
  return (
    <div className={css.nodesScroller}>
      <div className={css.nodesTrack} style={{ gridTemplateColumns: template }}>
        {columns.map((column, index) => {
          const key = column.node.self ? 'self' : column.node.id ?? column.node.name
          const count = column.pinned.length + column.rest.length
          const renderCard = (card: PinnedCard, pinned: boolean): ReactNode => (
            <li key={card.id}>
              <SessionCardView
                card={card}
                state={card.state}
                pinned={pinned}
                pinPending={pinBusy.has(card.id)}
                workspace={workspaceName(card, workspaces, t)}
                t={t}
                now={now}
                useSessionAccess={useSessionAccess}
                onOpen={() => {
                  onOpen(card)
                }}
                onOpenSession={() => {
                  onOpenSession(card)
                }}
                onTogglePin={() => {
                  onTogglePin(card, pinned)
                }}
              />
            </li>
          )
          return (
            <section className={css.nodeColumn} key={key} aria-labelledby={'session-manager-node-' + String(index)}>
              <header className={css.nodeHead}>
                <span
                  className={css.nodeName}
                  id={'session-manager-node-' + String(index)}
                  data-self={column.node.self ? 'true' : undefined}
                  title={column.node.instanceId === undefined
                    ? column.node.name
                    : column.node.name + ' · ' + column.node.instanceId}
                >
                  {column.node.self ? 'self' : column.node.name}
                </span>
                {column.node.instanceId !== undefined && (
                  <span className={css.nodeHash} title={column.node.instanceId}>
                    {column.node.instanceId.slice(4, 12)}
                  </span>
                )}
                <span className={css.columnCount}>{count}</span>
              </header>
              <div className={css.nodeBody}>
                {column.pinned.length > 0 && (
                  <div className={css.nodePinned}>
                    <IconPinFillRegular size={12} />
                    <span>{t('nodes.pinned')}</span>
                  </div>
                )}
                <ul className={css.cards}>
                  {column.pinned.map((card) => renderCard(card, true))}
                  {column.rest.map((card) => renderCard(card, false))}
                </ul>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** Props of the full-list search dialog. */
interface SearchDialogProps {
  readonly hits: readonly SessionHit[]
  readonly workspaces: readonly WorkspaceView[]
  readonly now: number
  readonly t: Translate
  readonly onPick: (hit: SessionHit) => void
  readonly onClose: () => void
}

/**
 * Render the full-list Session search in a dialog.
 *
 * The dialog opens with the field focused and the whole newest-first hit set listed, so it is also a
 * quick jump list. Typing filters it by title and by the Workspace each row lives in; a row opens
 * the board's preview dialog, which is why a waiting Session still surfaces its native question.
 * The arrow keys and Enter work from the field, and the Modal layer keeps Escape for closing.
 * @param props - the search hits, Workspaces for the row hint, the clock, copy, and two actions.
 * @returns the search dialog.
 */
function SessionSearchDialog({
  hits,
  workspaces,
  now,
  t,
  onPick,
  onClose,
}: SearchDialogProps): ReactNode {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const results = matchSessions(hits, query, workspaces)
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0))

  // The Modal layer focuses this field on open; focusing here as well keeps the caret in it after a
  // re-render that replaces the list.
  useEffect(() => {
    search.current?.focus()
  }, [])

  // Keep the arrow-key highlight visible in a long list, the same way the Workspace menu does.
  useEffect(() => {
    list.current?.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, results.length])

  /**
   * Walk the results with the arrow keys and open the active one with Enter.
   * @param event - key event on the search field.
   */
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    // An IME owns the arrow keys and Enter while it composes; picking a candidate must not move the
    // result highlight or open a row.
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive(Math.min(activeIndex + 1, Math.max(results.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(Math.max(activeIndex - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const hit = results[activeIndex]
      if (hit !== undefined) onPick(hit)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('search.title')} headless className={css.searchDialog ?? ''}>
      <div className={css.searchFrame}>
        <div className={css.searchBar}>
          <Input
            ref={search}
            className={css.searchInput ?? ''}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            icon={<IconSearchOutlineRegular size={16} />}
            spellCheck={false}
            autoComplete="off"
            {...{ 'data-modal-autofocus': true }}
          />
          <button
            type="button"
            className={css.dialogClose}
            aria-label={t('preview.close')}
            title={t('preview.close')}
            onClick={onClose}
          >
            <IconCloseOutlineRegular size={14} />
          </button>
        </div>
        {results.length === 0
          ? <p className={css.searchEmpty} role="status">{t('search.empty')}</p>
          : (
            <ul ref={list} className={css.searchList} role="listbox" aria-label={t('search.title')}>
              {results.map((hit, index) => {
                const workspace = workspaceName(hit, workspaces, t)
                const node = hit.node.self ? 'self' : hit.node.name
                const scope = workspace === '' ? node : node + ' · ' + workspace
                return (
                  <li key={hit.id} role="none">
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      data-active={index === activeIndex ? 'true' : undefined}
                      className={css.searchRow}
                      onClick={() => {
                        onPick(hit)
                      }}
                      onMouseMove={() => {
                        setActive(index)
                      }}
                    >
                      <span className={css.searchRowTitle} title={hit.title}>{hit.title}</span>
                      <span className={css.searchRowMeta}>
                        <span className={css.searchRowWorkspace}>{scope}</span>
                        <span className={css.searchRowState}>{stateText(hit.state, hit, t)}</span>
                        <span className={css.searchRowTime} title={fullDate(hit.updatedAt)}>
                          {timeText(hit.updatedAt, now, t)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
      </div>
    </Modal>
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
    archiveSession,
    openPreviewDestination,
    settings,
    saveSettings,
    sharedStatus,
    useSessionAccess,
    SessionProvider,
    renderSlot,
    t,
  } = props
  const list = useSessions((state) => state)
  const statuses = useSessionStatus((state) => state)
  const sharedStatuses = useSyncExternalStore(sharedStatus.subscribe, sharedStatus.getSnapshot)
  const workspaces = useWorkspaces((state) => state)
  const archived = workspaces.archivedSessionIds
  const [now, setNow] = useState(() => Date.now())
  const [preview, setPreview] = useState<Preview | undefined>(undefined)
  const [previewError, setPreviewError] = useState<string | undefined>(undefined)
  const [composer, setComposer] = useState<Composer | undefined>(undefined)
  const [startError, setStartError] = useState<string | undefined>(undefined)
  const [tab, setTab] = useState<PageTab>('board')
  const [remotePins, setRemotePins] = useState<readonly SessionId[]>(() => readRemotePins())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
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

  // Remote pins live in the browser, so another tab's pin change arrives as a storage event.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== REMOTE_PIN_KEY) return
      setRemotePins(readRemotePins())
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  // The preview owns one retained Session reference. Releasing it in the effect cleanup runs after
  // the Conversation for the old reference has unmounted, including when the page itself unmounts.
  const previewReference = preview?.reference
  useEffect(() => {
    if (previewReference === undefined) return
    return () => {
      previewReference.release()
    }
  }, [previewReference])

  // A preview is a live conversation. DSH retires its own unread marker only for a `mainView`
  // retention, and an embedded preview is deliberately not one, so the board settles the mark
  // itself: a turn that finishes while its conversation is on screen has been read. The layout
  // effect writes the mark before the paint, so the card never flashes through Unread.
  const presentedId = preview?.card.id
  useLayoutEffect(() => {
    if (presentedId === undefined) return
    const shared = sharedStatuses.get(presentedId)
    if (shared?.unread === true) void sharedStatus.read(presentedId)
    const mark = previewReadMark(list, statuses, presentedId, completionReadAt)
    if (mark === undefined) return
    completionReadAt.set(presentedId, mark)
    clearLocalCompletion(presentedId)
    bumpBoardRevision((value) => value + 1)
  }, [presentedId, list, statuses, sharedStatuses, sharedStatus, bumpBoardRevision])

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
  const localPinnedIds = new Set(workspaces.pinnedSessionIds)
  const pinnedSessionIds = [
    ...workspaces.pinnedSessionIds,
    ...remotePins.filter((id) => !localPinnedIds.has(id)),
  ]
  const pinned = derivePinned(list, statuses, archived, pinnedSessionIds, completionReadAt, locallyCompleted, sharedStatuses)
  const pinnedIds = new Set(pinned.map((card) => card.id))
  const board = deriveBoard(list, statuses, archived, locallyCompleted, completionReadAt, sharedStatuses)
  const nodeColumns = deriveNodeColumns(
    list,
    statuses,
    archived,
    pinnedSessionIds,
    completionReadAt,
    locallyCompleted,
    sharedStatuses,
  )
  const windowDays = recentWindowDays()
  const recent = withinRecent(board.recent, now, windowDays)
  const columns: Record<BoardColumn, readonly SessionCard[]> = {
    running: board.running.filter((card) => !pinnedIds.has(card.id)),
    unread: board.unread.filter((card) => !pinnedIds.has(card.id)),
    recent: recent.filter((card) => !pinnedIds.has(card.id)),
  }
  const total = columns.running.length + columns.unread.length + columns.recent.length + pinned.length
  const tabOptions: readonly SegmentedControlOption<PageTab>[] = [
    { value: 'board', label: t('tab.board') },
    { value: 'nodes', label: t('tab.nodes') },
    { value: 'management', label: t('tab.management') },
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
    void sharedStatus.read(card.id)
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
    void sharedStatus.read(card.id)
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

  /**
   * Close the search dialog and open the picked result in the preview dialog.
   *
   * The dialog owns no Session reference, so there is nothing to release here; `openPreview` retains
   * the one the preview needs and acknowledges a completed result.
   * @param hit - the picked search result.
   */
  function openSearchHit(hit: SessionHit): void {
    setSearchOpen(false)
    openPreview(hit, hit.state)
  }

  /**
   * Open a management row in the same preview dialog the board and search use.
   * @param hit - the picked row.
   */
  function openManagedSession(hit: SessionHit): void {
    openPreview(hit, hit.state)
  }

  /**
   * Select one page tab, closing the board's settings dialog with it.
   * @param next - the tab to show.
   */
  function selectTab(next: PageTab): void {
    setTab(next)
    setSettingsOpen(false)
  }

  /** Leave the preview; its effect cleanup releases the retained reference. */
  function closePreview(): void {
    setNow(Date.now())
    setPreview(undefined)
  }

  /**
   * Close the preview and open the new-conversation overlay in its Workspace and Agent preset.
   *
   * The previewed Session supplies the target; an absent Workspace or preset falls back to the
   * native current/recent Workspace and the Host default.
   */
  function newSessionFromPreview(): void {
    if (preview === undefined) return
    const card = preview.card
    const workspace = workspaceOf(card, workspaces.items)
    const agentPreset = sessionPreset(list, card.id)
    closePreview()
    void startConversation({
      ...(workspace === undefined ? {} : { workspaceId: workspace.workspaceId }),
      ...(agentPreset === undefined ? {} : { agentPreset }),
    })
  }

  /**
   * Start a new conversation without navigating.
   *
   * The target follows the native New Session order: the Workspace of the Session the app currently
   * shows, then the Workspace with the most recent activity. The Workspace controller resolves the
   * blank itself, so the overlay gets the same reused Session and Agent preset the main New Session
   * would.
   */
  async function startConversation(target?: ConversationTarget): Promise<void> {
    if (opening.current) return
    opening.current = true
    setStartError(undefined)
    try {
      const workspaceId = target?.workspaceId
        ?? currentWorkspaceId(workspaces, list)
        ?? recentWorkspaceId(workspaces, list)
      if (workspaceId === undefined) throw new Error(t('new.failed'))
      const sessionId = await connectWorkspace(workspaceId, target?.agentPreset)
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
   * Pin or unpin one Session.
   *
   * A local Session uses the Host workspace pin, so the native rail and the columns stay in sync. A
   * remote Session cannot enter this Host's workspace registry; its pin belongs to the viewing
   * browser and is stored with the other remote pins. The ref only prevents a double click from
   * sending a local pin and unpin together; a failed local write is reported above the columns.
   * @param sessionId - Session to change.
   * @param pinned - whether the Session is pinned now.
   */
  async function togglePin(sessionId: SessionId, pinned: boolean): Promise<void> {
    setPinError(undefined)
    const remote = list.byId[sessionId] !== undefined && !sessionNodeOf(list, sessionId).self
    if (remote) {
      const next = toggleRemotePin(remotePins, sessionId, pinned)
      setRemotePins(next)
      writeRemotePins(next)
      return
    }
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

  /**
   * Hand a click from an embedded Conversation to the real Session page.
   *
   * The page owns the right column a file reference or a web link opens in, so the click navigates
   * there and the destination opens as soon as that column mounts — the same response the click
   * would have had on the page itself. A destination the click does not name (an image file link
   * the renderer draws without a title) only navigates.
   * @param destination - what the click asked to open, when the surface knows it.
   */
  function openDestination(destination: PreviewDestination | undefined): void {
    if (preview === undefined) return
    if (!openSessionPage(preview.card, preview.state)) {
      setPreview(undefined)
      return
    }
    if (destination !== undefined) openPreviewDestination(preview.card.id, destination)
  }

  /** Keep the retained Session and expand the question dialog into the embedded page. */
  function openPage(): void {
    setPreview((current) => current === undefined || current.kind !== 'question'
      ? current
      : { ...current, mode: 'page' })
  }

  const previewTitle = preview === undefined
    ? ''
    : list.byId[preview.card.id] === undefined
      ? preview.card.title
      : sessionDisplayTitle(list.byId[preview.card.id]?.displayTitle ?? preview.card.title, preview.card.node)
  const previewSubtitle = preview === undefined
    ? ''
    : [
        preview.card.node.self ? 'self' : preview.card.node.name,
        workspaceName(preview.card, workspaces.items, t),
        timeText(preview.card.updatedAt, now, t),
      ]
        .filter((part) => part !== '')
        .join(' · ')

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
        {/* The expanded preview is embedded too, so it hands the same clicks to the real page. */}
        <div
          className={css.previewBody}
          onClickCapture={(event) => {
            if (!handsOffToSessionPage(event)) return
            event.preventDefault()
            event.stopPropagation()
            openDestination(previewDestination(event))
          }}
        >
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
          <SegmentedControl
            id="session-manager"
            className={css.viewSwitch ?? ''}
            value={tab}
            options={tabOptions}
            onChange={selectTab}
            label={t('tab.label')}
          />
          <div className={css.headerTools}>
            {tab === 'board' && total > 0 && (
              <span className={css.total}>{t('page.count', { count: total })}</span>
            )}
            {tab === 'board' && (
              <button
                type="button"
                className={css.searchTrigger}
                aria-label={t('search.open')}
                aria-haspopup="dialog"
                title={t('search.open')}
                onClick={() => {
                  setSearchOpen(true)
                }}
              >
                <IconSearchOutlineRegular size={16} />
              </button>
            )}
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
            {(tab === 'board' || tab === 'nodes') && (
              <button
                type="button"
                className={css.settings}
                aria-label={t('settings.open')}
                aria-haspopup="dialog"
                aria-expanded={settingsOpen}
                title={t('settings.open')}
                onClick={() => {
                  setSettingsOpen((open) => !open)
                }}
              >
                <IconSettingsOutlineRegular size={16} />
              </button>
            )}
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

        {(tab === 'board' || tab === 'nodes') && pinError !== undefined && (
          <p className={css.previewError} role="alert">
            {t('pin.failed')}: {pinError}
          </p>
        )}

        {tab === 'board' ? (
          <div className={css.tabPanel} role="tabpanel" id="session-manager-board-panel" aria-labelledby="session-manager-board">
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
                        workspace={workspaceName(card, workspaces.items, t)}
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
                                  ? card.waitingKind !== undefined
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
                                    workspace={workspaceName(card, workspaces.items, t)}
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
        ) : tab === 'nodes' ? (
          <div className={css.tabPanel} role="tabpanel" id="session-manager-nodes-panel" aria-labelledby="session-manager-nodes">
            {list.phase === 'pending' && nodeColumns.length === 0
              ? <p className={css.loading} role="status">{t('state.loading')}</p>
              : <NodesBoard
              columns={nodeColumns}
              pinBusy={pinBusy}
              workspaces={workspaces.items}
              t={t}
              now={now}
              useSessionAccess={useSessionAccess}
              onOpen={(card) => {
                openPreview(card, card.state)
              }}
              onOpenSession={(card) => {
                openSessionPage(card, card.state)
              }}
              onTogglePin={(card, pinned) => {
                void togglePin(card.id, pinned)
              }}
            />}
          </div>
        ) : (
          <div className={css.tabPanel} role="tabpanel" id="session-manager-management-panel" aria-labelledby="session-manager-management">
            <Management
              sessions={searchableSessions(list, statuses, archived, completionReadAt, locallyCompleted, sharedStatuses)}
              workspaces={workspaces.items}
              now={now}
              t={t}
              archiveSession={archiveSession}
              onPreview={openManagedSession}
            />
          </div>
        )}
        </div>
      </div>
      {preview !== undefined && preview.mode === 'dialog' && (
        <PreviewDialog
          key={preview.card.id}
          preview={preview}
          title={previewTitle}
          subtitle={previewSubtitle}
          waitingKind={preview.card.waitingKind}
          t={t}
          SessionProvider={SessionProvider}
          renderSlot={renderSlot}
          archiveSession={archiveSession}
          useSessionAccess={useSessionAccess}
          onClose={closePreview}
          onOpenPage={openPage}
          onOpenSession={() => {
            openRealPage(preview)
          }}
          onOpenDestination={openDestination}
          onNewSession={newSessionFromPreview}
        />
      )}
      {searchOpen && (
        <SessionSearchDialog
          hits={searchableSessions(list, statuses, archived, completionReadAt, locallyCompleted, sharedStatuses)}
          workspaces={workspaces.items}
          now={now}
          t={t}
          onPick={openSearchHit}
          onClose={() => {
            setSearchOpen(false)
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
      <SettingsDialog
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false)
        }}
        form={settings()}
        saveSettings={saveSettings}
        windowDays={windowDays}
        onWindowDays={setRecentWindowDays}
        t={t}
      />
    </>
  )
}
