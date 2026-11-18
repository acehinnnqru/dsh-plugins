/**
 * The session board, its management tab, its full-list session search, its new-conversation
 * overlay, and its waiting-answer dialog.
 *
 * The page header selects between **Board**, three columns over the live runtime state of every
 * listed Session, and **Management**, a selectable list for batch archiving. Most cards navigate
 * straight to the real Session page through `uiWorkspace.openSession`, so the conversation keeps its
 * native right Sidebar, view tabs, and header actions; the page arms the leading back control that
 * returns to the board.
 *
 * A waiting Session whose approval or question is answerable in this Client opens a dialog instead:
 * the native answer block is hosted in the board, so one click answers without leaving the page. A
 * peer Session only carries a shared-status kind and keeps navigating, because its answer stays on
 * the owning node.
 *
 * The embedded Conversations are the new-conversation overlay, centered on a blank Session this page
 * created or reused through the shared `conversation.content` Factory, and the waiting dialog's
 * answer block; accepted prompts hand the board back without navigating.
 * @module dsh-plugin-session-manager/client/page
 */

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconArchiveOutlineRegular,
  IconCloseOutlineRegular,
  IconNewChatOutlineRegular,
  IconPinFillRegular,
  IconPlusOutlineRegular,
  IconPinOutlineRegular,
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
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
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
  sessionNodeOf,
  waitingBlockKind,
  waitingCopyKey,
  withinRecent,
  type BoardColumn,
  type NodeColumn,
  type PinnedCard,
  type PinnedState,
  type SessionCard,
  type SessionNode,
  type WaitingBlockKind,
} from './board.ts'
import { armBackToBoard, disarmBackToBoard } from './back-to-board.ts'
import { clearLocalCompletion, localCompletionIds, subscribeLocalCompletions } from './completion-tracker.ts'
import { REMOTE_PIN_KEY, readRemotePins, toggleRemotePin, writeRemotePins } from './remote-pins.ts'
import { archivedSessions, matchSessions, searchableSessions, type SessionHit } from './session-search.ts'
import { fullDate, stateText, timeText, workspaceName, type Translate } from './session-view.ts'
import { Management } from './Management.tsx'
import { NewConversation } from './NewConversation.tsx'
import { NodeBadge } from './NodeBadge.tsx'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SettingsDialog } from './SettingsDialog.tsx'
import type { SessionManagerSettings } from './settings.ts'
import type { SharedStatusStore } from './status.ts'
import { NS, type SessionManagerKey } from './locales.ts'
import { currentWorkspaceId, recentWorkspaceId } from './new-conversation-target.ts'
import { recentWindowDays, setRecentWindowDays, subscribeRecentWindow } from './recent-window.ts'
import { CONVERSATION_SLOT, WAITING_SLOT } from './slots.ts'
import { setChooseNode, setPrepareNode } from './node-choice.ts'
import { setChooseWorkspace } from './workspace-choice.ts'
import css from './SessionBoard.module.css'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** An embedded Conversation the board shows: the new-conversation overlay or the waiting dialog. */
    sessionManager: unknown
  }
}

/** The actions the board needs; the registration injects them from the client services. */
export interface SessionManagerInjected {
  /** Retain one Session for an embedded Conversation; the page releases it with that surface. */
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
  /** Create a fresh local blank without the native blank-reuse scan. */
  readonly createLocalSession: (workspaceId: WorkspaceId, agentPreset?: string) => Promise<SessionId>
  /** Install an existing local Session into the Workspace projection immediately. */
  readonly adoptLocalSession: (workspaceId: WorkspaceId, sessionId: SessionId) => void
  /** Resolve once a peer-created Session reaches the federated list. */
  readonly waitForSession: (sessionId: SessionId) => Promise<void>
  /** Create a blank Session on one peer at a directory path. */
  readonly createRemoteSession: (
    nodeId: string,
    request: { readonly cwd: string; readonly agentPreset?: string },
  ) => Promise<SessionId>
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
   * Restore one archived Session.
   *
   * Archived rows are not on the board; the management tab's archived set is the surface that
   * puts one back, which is what makes a one-click archive on a card safe.
   * @param sessionId - Session to restore.
   */
  readonly unarchiveSession: (sessionId: SessionId) => Promise<void>
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

/** The main slot's props, the child slots, the translate seat, and Session retention. */
type PageProps =
  PropsRuntime<'main'>
  & PropsRenderSlots<typeof CONVERSATION_SLOT | typeof WAITING_SLOT>
  & PropsLocale<typeof NS>
  & InjectFace<SessionManagerInjected>

/** The page's three tabs: the board, per-node columns, and the management list. */
type PageTab = 'board' | 'nodes' | 'management'

/** The blank Session the new-conversation overlay is showing, and its two retained handles. */
interface Composer {
  /** Owns the embedded Conversation for as long as the overlay is mounted. */
  readonly reference: SessionReference
  /** Keeps the blank Session eligible for the native hero's Agent preset control. */
  readonly mainView: SessionReference
}

/** One waiting Session whose native answer block the dialog is showing. */
interface Waiting {
  /** The card that opened the dialog. */
  readonly card: SessionCard
  /** Pending interaction kind named by the dialog header. */
  readonly kind: WaitingBlockKind
  /** Registry key of the request the dialog opened; a replacement closes it. */
  readonly requestKey: string
  /** Owns the embedded composer chain for as long as the dialog is mounted. */
  readonly reference: SessionReference
}

/** Optional node, Workspace, directory, and Agent preset for the next new-conversation overlay. */
interface ConversationTarget {
  readonly node?: SessionNode
  readonly workspaceId?: WorkspaceId
  readonly cwd?: string
  readonly agentPreset?: string
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

/** One card's content, its state, and the pin and archive controls. */
interface SessionCardViewProps {
  readonly card: SessionCard
  readonly state: PinnedState
  readonly pinned: boolean
  readonly pinPending: boolean
  /** Workspace label shown after the node badge. */
  readonly workspace: string
  /** Whether the board currently has a peer and should show node identity. */
  readonly showNode: boolean
  readonly t: Translate
  readonly now: number
  readonly useSessionAccess: PageProps['useSessionAccess']
  readonly onOpen: () => void
  readonly onTogglePin: () => void
  /** Archive straight from the card; only the Recent column passes it. */
  readonly onArchive?: () => void
  /** One archive command is in flight for this card. */
  readonly archivePending?: boolean
}

/**
 * Render one Session card.
 *
 * The body is a button so the whole card opens the Session page. The pin and archive controls are
 * sibling buttons in the corner, not nested controls. They are hidden until the card is hovered or
 * focused; the pin stays visible while the card is pinned, and only renders when the Session's
 * access snapshot allows the toggle.
 * @param props - the card, its state label, pin state, copy, clock, and the two actions.
 * @returns the card.
 */
function SessionCardView({
  card,
  state,
  pinned,
  pinPending,
  workspace,
  showNode,
  t,
  now,
  useSessionAccess,
  onOpen,
  onTogglePin,
  onArchive,
  archivePending,
}: SessionCardViewProps): ReactNode {
  const pinAllowed = useSessionAccess(
    card.id,
    pinned ? 'workspace/unpinSession' : 'workspace/pinSession',
  )
  const archiveAllowed = useSessionAccess(card.id, 'workspace/archiveSession')
  // Archiving is a local registry action; a federated row has no owner-side command here.
  const showArchive = onArchive !== undefined && archiveAllowed === true && card.node.self
  return (
    <article
      className={css.card}
      data-state={state}
      data-pinned={pinned ? 'true' : undefined}
      data-archive={showArchive ? 'true' : undefined}
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
          {showNode && <NodeBadge node={card.node} />}
          {workspace !== '' && (
            <span className={css.cwd} title={card.cwd ?? workspace}>{workspace}</span>
          )}
        </span>
      </button>
      {showArchive && (
        <button
          type="button"
          className={css.archive}
          aria-label={t('card.archive')}
          title={t('card.archive')}
          aria-busy={archivePending === true}
          disabled={archivePending === true}
          onClick={onArchive}
        >
          <IconArchiveOutlineRegular size={14} />
        </button>
      )}
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
  readonly onNew: (node: SessionNode) => void
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
  onNew,
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
                showNode
                t={t}
                now={now}
                useSessionAccess={useSessionAccess}
                onOpen={() => {
                  onOpen(card)
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
                <button
                  type="button"
                  className={css.nodeNew}
                  title={t('nodes.new')}
                  aria-label={t('nodes.new')}
                  onClick={() => {
                    onNew(column.node)
                  }}
                >
                  <IconPlusOutlineRegular size={14} />
                </button>
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
  /** Whether node identity is meaningful; hidden when no peer is online. */
  readonly showNode: boolean
  readonly now: number
  readonly t: Translate
  readonly onPick: (hit: SessionHit) => void
  readonly onClose: () => void
}

/**
 * Render the full-list Session search in a dialog.
 *
 * The dialog opens with the field focused and the whole newest-first hit set listed, so it is also a
 * quick jump list. Typing filters it by title, by node, and by the Workspace each row lives in; a
 * picked row follows the board's open rule, including an answerable waiting Session's native block.
 * The arrow keys and Enter work from the field, and the Modal layer keeps Escape for closing.
 * @param props - the search hits, Workspaces for the row hint, the clock, copy, and two actions.
 * @returns the search dialog.
 */
function SessionSearchDialog({
  hits,
  workspaces,
  showNode,
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
            aria-label={t('dialog.close')}
            title={t('dialog.close')}
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
                const scope = !showNode ? workspace : workspace === '' ? node : node + ' · ' + workspace
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
 * Render the board, its search and settings dialogs, the new-conversation overlay, and the waiting
 * answer dialog.
 * @param props - main-slot standard props, the child slots, translate seat, and retention.
 * @returns the board page and its overlays.
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
    createLocalSession,
    adoptLocalSession,
    waitForSession,
    createRemoteSession,
    moveDraft,
    draftAttachmentCount,
    setPinned,
    archiveSession,
    unarchiveSession,
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
  const [openError, setOpenError] = useState<string | undefined>(undefined)
  const [composer, setComposer] = useState<Composer | undefined>(undefined)
  const [waiting, setWaiting] = useState<Waiting | undefined>(undefined)
  const [startError, setStartError] = useState<string | undefined>(undefined)
  const [tab, setTab] = useState<PageTab>('board')
  const [hasPeerNodes, setHasPeerNodes] = useState(false)
  const [remotePins, setRemotePins] = useState<readonly SessionId[]>(() => readRemotePins())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [pinError, setPinError] = useState<string | undefined>(undefined)
  const [archiveBusy, setArchiveBusy] = useState<ReadonlySet<SessionId>>(() => new Set())
  const [archiveError, setArchiveError] = useState<string | undefined>(undefined)
  const archivingCards = useRef(new Set<SessionId>())
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
  const listRef = useRef(list)
  listRef.current = list
  const preparedRemote = useRef(new Map<string, { promise: Promise<SessionId>; sessionId?: SessionId }>())
  const composerRef = useRef<Composer | undefined>(undefined)
  composerRef.current = composer

  // The node UI is only meaningful with an online peer. Poll the directory the picker already uses;
  // when the network is off it returns no rows and every node affordance disappears.
  useEffect(() => {
    let live = true
    const load = async (): Promise<void> => {
      if (typeof fetch !== 'function') return
      try {
        const response = await fetch('/api/session-manager/nodes')
        if (!response.ok) {
          if (live) setHasPeerNodes(false)
          return
        }
        const body = await response.json() as { nodes?: readonly { self?: unknown }[] }
        const peers = (body.nodes ?? []).some((node) => node.self !== true)
        if (live) setHasPeerNodes(peers)
      } catch {
        if (live) setHasPeerNodes(false)
      }
    }
    void load()
    const timer = setInterval(() => {
      void load()
    }, 5000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])

  // A remote row is itself proof of a peer, even if the directory poll has not landed yet.
  const showNodes = hasPeerNodes || list.ids.some((id) => !sessionNodeOf(list, id).self)
  useEffect(() => {
    if (!showNodes && tab === 'nodes') setTab('board')
  }, [showNodes, tab])

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
      setChooseNode(undefined)
      setPrepareNode(undefined)
    }
  }, [])

  // Relative labels are the only clock-dependent copy on the page. A slow tick keeps them honest
  // without re-deriving the board, which only changes when Session state does. The tick pauses while
  // an embedded Conversation is mounted, so neither the new-conversation overlay nor the waiting
  // dialog is re-rendered by the clock.
  useEffect(() => {
    if (composer !== undefined || waiting !== undefined) return undefined
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 30_000)
    return () => {
      clearInterval(timer)
    }
  }, [composer, waiting])

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

  // The waiting dialog owns one retained Session; closing it releases that handle.
  const waitingReference = waiting?.reference
  useEffect(() => {
    if (waitingReference === undefined) return
    return () => {
      waitingReference.release()
    }
  }, [waitingReference])

  // Answering the request removes it from the registry; the dialog has nothing left to show, so it
  // closes on the same update. A replacement with a different domain also closes instead of letting
  // the composer chain fall back to the ordinary input bar.
  useEffect(() => {
    if (waiting === undefined) return
    const interaction = statuses.get(waiting.card.id)?.pendingInteraction
    if (interaction === undefined || interaction.key !== waiting.requestKey
      || waitingBlockKind(interaction) === undefined) {
      setWaiting(undefined)
    }
  }, [statuses, waiting])

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
    ...(showNodes ? [{ value: 'nodes' as const, label: t('tab.nodes') }] : []),
    { value: 'management', label: t('tab.management') },
  ]
  const visibleTab: PageTab = showNodes ? tab : tab === 'nodes' ? 'board' : tab

  /**
   * Open one Session from a card, a search hit, or a management row.
   *
   * A waiting Session whose native approval or question block is answerable in this Client shows
   * that block in place; every other row, including a peer row that only has a shared-status kind,
   * opens the real Session page.
   * @param card - the clicked card, hit, or row.
   * @param state - the column or pinned state that owns the card.
   */
  function openCard(card: SessionCard, state: PinnedState): void {
    const interaction = statuses.get(card.id)?.pendingInteraction
    const kind = waitingBlockKind(interaction)
    if (state === 'waiting' && kind !== undefined && interaction !== undefined) {
      openWaiting(card, kind, interaction.key)
      return
    }
    openSessionPage(card, state)
  }

  /**
   * Show the native answer block for one waiting Session without leaving the board.
   * @param card - the waiting card.
   * @param kind - the approval or question domain the block answers.
   * @param requestKey - registry key of the request being answered.
   */
  function openWaiting(card: SessionCard, kind: WaitingBlockKind, requestKey: string): void {
    setOpenError(undefined)
    try {
      const reference = retainSession(card.id)
      void sharedStatus.read(card.id)
      setWaiting({ card, kind, requestKey, reference })
    } catch {
      // A reference can fail when the row left the list between render and click; the native page
      // is still the fallback.
      openSessionPage(card, 'waiting')
    }
  }

  /**
   * Open the Session page and arm the return control.
   *
   * Every surface on this page navigates here except a waiting Session with an answerable block.
   * The page the product's own navigation opens owns the composer, the question takeovers, and the
   * right Sidebar.
   * @param card - the clicked card, hit, or row.
   * @param state - the column or pinned state that owns the card.
   */
  function openSessionPage(card: SessionCard, state: PinnedState): void {
    setOpenError(undefined)
    void sharedStatus.read(card.id)
    armBackToBoard()
    try {
      openSession(card.id)
    } catch (cause) {
      disarmBackToBoard()
      setOpenError(cause instanceof Error ? cause.message : String(cause))
      return
    }
    // The real page is now the visible conversation; a completed card has been acknowledged.
    if (state === 'completed') {
      clearLocalCompletion(card.id)
      completionReadAt.set(card.id, card.updatedAt)
    }
  }

  /**
   * Close the search dialog and open the picked result.
   * @param hit - the picked search result.
   */
  function openSearchHit(hit: SessionHit): void {
    setSearchOpen(false)
    openCard(hit, hit.state)
  }

  /**
   * Open a management row.
   * @param hit - the picked row.
   */
  function openManagedSession(hit: SessionHit): void {
    openCard(hit, hit.state)
  }

  /**
   * Select one page tab, closing the board's settings dialog with it.
   * @param next - the tab to show.
   */
  function selectTab(next: PageTab): void {
    setTab(next)
    setSettingsOpen(false)
  }

  /** Find one Workspace by its path. */
  function workspaceAt(path: string | undefined): WorkspaceView | undefined {
    return path === undefined ? undefined : workspacesRef.current.items.find((workspace) => workspace.path === path)
  }

  /** The newest directory a node already uses, for a column's new-session button. */
  function nodeDirectory(node: SessionNode): string | undefined {
    let latest: { readonly updatedAt: number; readonly cwd: string | undefined } | undefined
    const current = listRef.current
    for (const id of current.ids) {
      const row = current.byId[id]
      if (row === undefined) continue
      const owner = sessionNodeOf(current, id)
      if (node.self ? !owner.self : owner.id !== node.id) continue
      if (row.cwd === undefined) continue
      if (latest === undefined || row.updatedAt > latest.updatedAt) latest = { updatedAt: row.updatedAt, cwd: row.cwd }
    }
    return latest?.cwd
  }

  /** Warm one peer's blank at a known directory and Agent preset. */
  function prepareRemote(node: SessionNode, cwd: string, agentPreset?: string): void {
    if (node.self || node.id === undefined) return
    const fromId = composerRef.current?.reference.sessionId
    if (fromId !== undefined) {
      const owner = sessionNodeOf(listRef.current, fromId)
      if (!owner.self && owner.id === node.id) return
    }
    const key = node.id + '\n' + cwd + '\n' + (agentPreset ?? '')
    const prior = preparedRemote.current.get(key)
    if (prior !== undefined) {
      if (prior.sessionId === undefined) return
      const row = listRef.current.byId[prior.sessionId]
      if (row !== undefined && row.blank === true) return
      preparedRemote.current.delete(key)
    }
    const parked = listRef.current.ids.some((id) => {
      const row = listRef.current.byId[id]
      if (row === undefined || row.blank !== true || row.cwd !== cwd || archived.includes(id)) return false
      const owner = sessionNodeOf(listRef.current, id)
      return !owner.self && owner.id === node.id
    })
    if (parked) return
    const prepared = createRemoteSession(node.id, {
      cwd,
      ...(agentPreset === undefined ? {} : { agentPreset }),
    })
      .then(async (sessionId) => {
        await waitForSession(sessionId)
        return sessionId
      })
    const entry: { promise: Promise<SessionId>; sessionId?: SessionId } = { promise: prepared }
    preparedRemote.current.set(key, entry)
    void prepared.then((sessionId) => {
      if (preparedRemote.current.get(key)?.promise === prepared) entry.sessionId = sessionId
    }).catch(() => {
      if (preparedRemote.current.get(key)?.promise === prepared) preparedRemote.current.delete(key)
    })
  }

  /** Warm the node menu target from the open conversation. */
  function prepareNode(node: SessionNode): void {
    const fromId = composerRef.current?.reference.sessionId
    if (node.self || node.id === undefined || fromId === undefined) return
    const source = listRef.current.byId[fromId]
    if (source === undefined) return
    const workspacesNow = workspacesRef.current
    const workspace = workspaceAt(source.cwd)
      ?? workspacesNow.items.find((item) => item.workspaceId === currentWorkspaceId(workspacesNow, listRef.current))
      ?? workspacesNow.items.find((item) => item.workspaceId === recentWorkspaceId(workspacesNow, listRef.current))
    const cwd = workspace?.path ?? nodeDirectory(node)
    if (cwd === undefined) return
    prepareRemote(node, cwd)
  }

  /** Warm every online peer as soon as the overlay opens. */
  async function warmPeers(cwd: string | undefined): Promise<void> {
    if (cwd === undefined) return
    try {
      const response = await fetch('/api/session-manager/nodes')
      if (!response.ok || !mounted.current || composerRef.current === undefined) return
      const body = await response.json() as { nodes?: readonly { nodeId?: unknown; name?: unknown; self?: unknown }[] }
      for (const value of body.nodes ?? []) {
        if (typeof value.nodeId !== 'string' || typeof value.name !== 'string' || value.self === true) continue
        prepareRemote({ id: value.nodeId, name: value.name, self: false }, cwd)
      }
    } catch {
      // A later menu preview retries the warm-up.
    }
  }

  /**
   * Create one blank on a node, at a Workspace path when it has one.
   *
   * A local node reuses the Workspace controller's blank resolution. A remote node has no local
   * Workspace id here, so the peer creates a blank at the chosen directory and the federated list
   * supplies the row before the overlay retains it.
   */
  async function createBlank(
    node: SessionNode,
    workspace: WorkspaceView | undefined,
    agentPreset?: string,
    fallbackCwd?: string,
    fresh = false,
  ): Promise<SessionId> {
    if (node.self) {
      if (workspace === undefined) throw new Error(t('new.failed'))
      if (!fresh) return await connectWorkspace(workspace.workspaceId, agentPreset)
      const parked = listRef.current.ids.find((id) => {
        const row = listRef.current.byId[id]
        if (row === undefined || row.blank !== true || row.cwd !== workspace.path || archived.includes(id)) return false
        if (Object.values(row.retainedBy).some((count) => typeof count === 'number' && count > 0)) return false
        if (!sessionNodeOf(listRef.current, id).self) return false
        const preset = (row.projectionValues as Readonly<Record<string, unknown>> | undefined)?.['agentPreset']
        return agentPreset === undefined || typeof preset !== 'string' || preset === agentPreset
      })
      if (parked !== undefined) {
        adoptLocalSession(workspace.workspaceId, parked)
        return parked
      }
      return await createLocalSession(workspace.workspaceId, agentPreset)
    }
    const cwd = workspace?.path ?? fallbackCwd ?? nodeDirectory(node)
    if (node.id === undefined || cwd === undefined) throw new Error(t('new.failed'))
    const key = node.id + '\n' + cwd + '\n' + (agentPreset ?? '')
    const existing = listRef.current.ids.find((id) => {
      const row = listRef.current.byId[id]
      if (row === undefined || row.blank !== true || row.cwd !== cwd || archived.includes(id)) return false
      const owner = sessionNodeOf(listRef.current, id)
      if (owner.self || owner.id !== node.id) return false
      const preset = (row.projectionValues as Readonly<Record<string, unknown>> | undefined)?.['agentPreset']
      return agentPreset === undefined || typeof preset !== 'string' || preset === agentPreset
    })
    if (existing !== undefined) {
      preparedRemote.current.delete(key)
      return existing
    }
    const prepared = preparedRemote.current.get(key)
    if (prepared !== undefined) {
      try {
        const sessionId = await prepared.promise
        if (preparedRemote.current.get(key) === prepared) preparedRemote.current.delete(key)
        const row = listRef.current.byId[sessionId]
        if (row !== undefined && row.blank === true) return sessionId
      } catch {
        if (preparedRemote.current.get(key) === prepared) preparedRemote.current.delete(key)
      }
    }
    const sessionId = await createRemoteSession(node.id, {
      cwd,
      ...(agentPreset === undefined ? {} : { agentPreset }),
    })
    await waitForSession(sessionId)
    return sessionId
  }

  /**
   * Start a new conversation without navigating.
   *
   * The target follows the native New Session order: the Workspace of the Session the app currently
   * shows, then the Workspace with the most recent activity. The Workspace controller resolves the
   * blank itself, so the overlay gets the same reused Session and Agent preset the main New Session
   * would. A remote target creates its blank through the bridge instead.
   */
  async function startConversation(target?: ConversationTarget): Promise<void> {
    if (opening.current) return
    opening.current = true
    setStartError(undefined)
    try {
      const node = target?.node ?? { id: undefined, name: 'self', self: true }
      const workspace = target?.workspaceId !== undefined
        ? workspaces.items.find((item) => item.workspaceId === target.workspaceId)
        : target?.cwd !== undefined
          ? workspaceAt(target.cwd)
          : workspaces.items.find((item) => item.workspaceId === currentWorkspaceId(workspaces, list))
            ?? workspaces.items.find((item) => item.workspaceId === recentWorkspaceId(workspaces, list))
      if (node.self && workspace === undefined) throw new Error(t('new.failed'))
      const sessionId = await createBlank(node, workspace, target?.agentPreset, target?.cwd)
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
      setChooseNode(switchNode)
      setPrepareNode(prepareNode)
      setComposer({ reference, mainView })
      void warmPeers(workspace?.path ?? target?.cwd)
    } catch (cause) {
      setStartError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      opening.current = false
    }
  }

  /** Hand the screen back to the board; the release effect drops the retained references. */
  function closeConversation(): void {
    setChooseWorkspace(undefined)
    setChooseNode(undefined)
    setPrepareNode(undefined)
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
   * Archive one card straight from the Recent column.
   *
   * The Host refuses a Session whose work is still running; the card then stays put and the
   * refusal is reported above the board. The archived set lives in the management tab, so the
   * action needs no confirmation and no undo toast.
   * @param sessionId - card the user archived.
   */
  function archiveCard(sessionId: SessionId): void {
    if (archivingCards.current.has(sessionId)) return
    archivingCards.current.add(sessionId)
    setArchiveError(undefined)
    setArchiveBusy(new Set(archivingCards.current))
    void archiveSession(sessionId).catch((cause: unknown) => {
      setArchiveError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      archivingCards.current.delete(sessionId)
      setArchiveBusy(new Set(archivingCards.current))
    })
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
    if (workspacesRef.current.items.find((workspace) => workspace.workspaceId === workspaceId)?.path === listRef.current.byId[fromId]?.cwd) return undefined
    if (switching.current) return undefined
    switching.current = true
    try {
      if (draftAttachmentCount(fromId) > 0) return t('workspace.attachments')
      const node = sessionNodeOf(listRef.current, fromId)
      const workspace = workspacesRef.current.items.find((item) => item.workspaceId === workspaceId)
      if (workspace === undefined) return t('new.failed')
      const sessionId = await createBlank(node, workspace)
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
   * Move the open new conversation to another node.
   *
   * The source blank supplies its directory; a remote target reuses that path, or the newest
   * directory already known on that node. The draft follows the same way a Workspace switch moves
   * it, and attachments refuse the move rather than being dropped.
   * @param fromId - the blank Session the overlay is showing.
   * @param node - the node the user picked.
   * @returns a localized failure, or undefined after the overlay moved.
   */
  async function switchNode(fromId: SessionId, node: SessionNode): Promise<string | undefined> {
    const current = composerRef.current
    if (current === undefined || current.reference.sessionId !== fromId) return undefined
    const currentList = listRef.current
    const source = currentList.byId[fromId]
    if (source === undefined) return undefined
    const owner = sessionNodeOf(currentList, fromId)
    if (node.self ? owner.self : owner.id === node.id) return undefined
    if (switching.current) return undefined
    switching.current = true
    try {
      if (draftAttachmentCount(fromId) > 0) return t('node.attachments')
      const currentWorkspaces = workspacesRef.current
      const workspace = workspaceAt(source.cwd)
        ?? currentWorkspaces.items.find((item) => item.workspaceId === currentWorkspaceId(currentWorkspaces, currentList))
        ?? currentWorkspaces.items.find((item) => item.workspaceId === recentWorkspaceId(currentWorkspaces, currentList))
      const targetCwd = nodeDirectory(node) ?? source.cwd
      const sessionId = await createBlank(node, workspace, undefined, targetCwd, true)
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

  return (
    <>
      <div className={css.page}>
      <div className={css.content}>
        <header className={css.header}>
          <SegmentedControl
            id="session-manager"
            className={css.viewSwitch ?? ''}
            value={visibleTab}
            options={tabOptions}
            onChange={selectTab}
            label={t('tab.label')}
          />
          <div className={css.headerTools}>
            {visibleTab === 'board' && total > 0 && (
              <span className={css.total}>{t('page.count', { count: total })}</span>
            )}
            {visibleTab === 'board' && (
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
            {(visibleTab === 'board' || visibleTab === 'nodes') && (
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

        {openError !== undefined && (
          <p className={css.pageError} role="alert">
            {t('open.failed')}: {openError}
          </p>
        )}

        {startError !== undefined && (
          <p className={css.pageError} role="alert">
            {t('new.failed')}: {startError}
          </p>
        )}

        {(visibleTab === 'board' || visibleTab === 'nodes') && pinError !== undefined && (
          <p className={css.pageError} role="alert">
            {t('pin.failed')}: {pinError}
          </p>
        )}

        {visibleTab === 'board' && archiveError !== undefined && (
          <p className={css.pageError} role="alert">
            {t('card.archiveFailed')}: {archiveError}
          </p>
        )}

        {visibleTab === 'board' ? (
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
                        showNode={showNodes}
                        t={t}
                        now={now}
                        useSessionAccess={useSessionAccess}
                        onOpen={() => {
                          openCard(card, card.state)
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
                              // A one-click archive only on Recent: those rows are settled, so the
                              // Host cannot refuse them for running work, and the management tab
                              // holds the archived set to restore from.
                              const archive = column === 'recent' && card.node.self
                                ? { onArchive: (): void => { archiveCard(card.id) } }
                                : {}
                              return (
                                <li key={card.id}>
                                  <SessionCardView
                                    card={card}
                                    state={state}
                                    pinned={false}
                                    pinPending={pinBusy.has(card.id)}
                                    archivePending={archiveBusy.has(card.id)}
                                    workspace={workspaceName(card, workspaces.items, t)}
                                    showNode={showNodes}
                                    t={t}
                                    now={now}
                                    useSessionAccess={useSessionAccess}
                                    onOpen={() => {
                                      openCard(card, state)
                                    }}
                                    onTogglePin={() => {
                                      void togglePin(card.id, false)
                                    }}
                                    {...archive}
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
        ) : visibleTab === 'nodes' ? (
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
                openCard(card, card.state)
              }}
              onNew={(node) => {
                const cwd = node.self ? undefined : nodeDirectory(node)
                void startConversation({ node, ...(cwd === undefined ? {} : { cwd }) })
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
              showNode={showNodes}
              now={now}
              t={t}
              archiveSession={archiveSession}
              unarchiveSession={unarchiveSession}
              archivedSessions={archivedSessions(list, statuses, archived, completionReadAt, locallyCompleted, sharedStatuses)}
              onOpen={openManagedSession}
            />
          </div>
        )}
        </div>
      </div>
      {searchOpen && (
        <SessionSearchDialog
          hits={searchableSessions(list, statuses, archived, completionReadAt, locallyCompleted, sharedStatuses)}
          workspaces={workspaces.items}
          showNode={showNodes}
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
          onSent={(sessionId) => {
            sharedStatus.noteRunning(sessionId)
            closeConversation()
          }}
          onClose={closeConversation}
        />
      )}
      {waiting !== undefined && (
        <Modal
          open
          headless
          title={t(waitingCopyKey(waiting.kind))}
          onClose={() => {
            setWaiting(undefined)
          }}
          className={css.waitingDialog ?? ''}
        >
          <div className={css.waitingFrame}>
            <header className={css.waitingBar}>
              <div className={css.waitingHeading}>
                <span className={css.waitingEyebrow}>{t(waitingCopyKey(waiting.kind))}</span>
                <span className={css.waitingTitle} title={waiting.card.title}>
                  {waiting.card.title}
                </span>
              </div>
              <button
                type="button"
                className={css.dialogClose}
                aria-label={t('dialog.close')}
                title={t('dialog.close')}
                onClick={() => {
                  setWaiting(undefined)
                }}
              >
                <IconCloseOutlineRegular size={14} />
              </button>
            </header>
            <div className={css.waitingBody}>
              <SessionProvider session={waiting.reference}>
                {renderSlot(WAITING_SLOT, {})}
              </SessionProvider>
            </div>
          </div>
        </Modal>
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
