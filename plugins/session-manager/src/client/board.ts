/**
 * Pure derivation for the session board.
 *
 * The board is a kanban over three useful states: a turn is running, something is unread (a pending
 * interaction or an unacknowledged completion), or the Session is recent but already read. Recent
 * keeps a Session findable after it leaves Unread; blank drafts, archived rows, and subagent-origin
 * rows still have no column.
 *
 * Keeping the derivation here, apart from React and the slot props, is what lets the classification
 * be tested without a browser.
 * @module dsh-plugin-session-manager/client/board
 */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SharedStatus } from './status.ts'

/** The three board columns, in order. */
export const BOARD_COLUMNS = ['running', 'unread', 'recent'] as const

/** One board column. */
export type BoardColumn = (typeof BOARD_COLUMNS)[number]

/** One owning node as a card or column sees it. */
export interface SessionNode {
  /** Server node id; absent for this host's own Sessions. */
  readonly id: string | undefined
  /** Display name; `self` for this host. */
  readonly name: string
  /** Whether the Session belongs to this host. */
  readonly self: boolean
  /** Stable installation hash of the owning node, when the Host reported one. */
  readonly instanceId?: string
}

/** The local node label used on cards and the Nodes tab. */
export const SELF_NODE: SessionNode = { id: undefined, name: 'self', self: true }

/** One Session card. */
export interface SessionCard {
  /** Session the card opens. */
  readonly id: SessionId
  /** Host-facing label: durable title, project basename, or the Session id. */
  readonly title: string
  /** Session working directory, when the Host reports one. */
  readonly cwd: string | undefined
  /** Latest durable activity, used to order cards newest first. */
  readonly updatedAt: number
  /** Domain kind of the pending interaction; only waiting cards carry one. */
  readonly waitingKind: string | undefined
  /** Owning node, used for the node badge and the Nodes tab. */
  readonly node: SessionNode
}

/** A card's label state: pending interaction, running, unread completion, or idle. */
export type PinnedState = 'waiting' | 'running' | 'completed' | 'idle'

/** Recent-window choices, in days. */
export const RECENT_WINDOW_DAYS = [1, 3, 7, 30] as const

/** One allowed Recent window length. */
export type RecentWindowDays = (typeof RECENT_WINDOW_DAYS)[number]

/** Default Recent window: three days. */
export const DEFAULT_RECENT_WINDOW_DAYS: RecentWindowDays = 3

/** One pinned card and the state its label uses. */
export interface PinnedCard extends SessionCard {
  readonly state: PinnedState
}

/** The derived board: one newest-first card list per column. */
export interface SessionBoard {
  /** Sessions with a running turn and no pending interaction. */
  readonly running: readonly SessionCard[]
  /** Pending interactions and completions that have not been acknowledged. */
  readonly unread: readonly SessionCard[]
  /** Read and idle Sessions, kept newest first so they remain findable. */
  readonly recent: readonly SessionCard[]
}

/** Copy keys that name a pending interaction. */
export type WaitingCopyKey = 'waiting.approval' | 'waiting.planReview' | 'waiting.question' | 'waiting.input'

/**
 * Map a runtime interaction kind to the card's copy key.
 *
 * The Web client's row presentation names three shipped domains; any future or plugin-contributed
 * domain still lands in **Unread**, just under the generic label.
 * @param kind - `pendingInteraction.kind`, or undefined when there is no interaction.
 * @returns the locale key naming why the Session waits.
 */
export function waitingCopyKey(kind: string | undefined): WaitingCopyKey {
  switch (kind) {
    case 'approval': return 'waiting.approval'
    case 'plan-review': return 'waiting.planReview'
    case 'question': return 'waiting.question'
    default: return 'waiting.input'
  }
}

/**
 * Keep recent cards inside the configured window.
 * @param cards - cards from the Recent column.
 * @param now - current epoch ms.
 * @param days - window length in days.
 * @returns cards whose latest activity is inside the inclusive window.
 */
export function withinRecent(
  cards: readonly SessionCard[],
  now: number,
  days: RecentWindowDays,
): readonly SessionCard[] {
  const since = now - days * 86_400_000
  return cards.filter((card) => card.updatedAt >= since)
}

/**
 * The read mark an open preview should record for the Session it shows.
 *
 * DSH retires its own unread marker only for a `mainView` retention, and an embedded preview is
 * deliberately not one, so a turn that finishes while the conversation is on screen still reports
 * `completionUnread`. The preview acknowledges it by keeping the read mark current, which is the
 * value the board's classification already trusts.
 * @param list - Session Controller list snapshot.
 * @param statuses - unified UI status by Session.
 * @param sessionId - Session the preview is showing.
 * @param readAt - completion read marks recorded so far.
 * @returns the mark to record, or undefined when the completion is already acknowledged.
 */
export function previewReadMark(
  list: SessionListState,
  statuses: SessionStatusSnapshot,
  sessionId: SessionId,
  readAt: ReadonlyMap<SessionId, number>,
): number | undefined {
  const row = list.byId[sessionId]
  if (row === undefined || statuses.get(sessionId)?.completionUnread !== true) return undefined
  const mark = readAt.get(sessionId)
  return mark !== undefined && mark >= row.updatedAt ? undefined : row.updatedAt
}

/**
 * Classify one eligible Session's runtime state.
 *
 * This is the single precedence rule behind the board's columns, the pinned rail, and the search
 * dialog: a pending interaction outranks a running turn (the same rule the Session row uses), a
 * running turn outranks a completion, and a completion whose read mark is current turns idle. A stop
 * this board observed itself stays completed even after that mark, so the board never loses the
 * unread state it just saw.
 * @param status - unified UI status; absent until the snapshot knows the row.
 * @param running - resolved running flag: the status's own value, or the list row's fallback.
 * @param read - whether a recorded read mark is at least as new as the row.
 * @param locallyDone - a stop this board observed and has not acknowledged.
 * @returns waiting, running, completed, or idle.
 */
export function sessionState(
  status: SessionStatus | undefined,
  running: boolean,
  read: boolean,
  locallyDone: boolean,
): PinnedState {
  if (status?.pendingInteraction !== undefined) return 'waiting'
  if (running) return 'running'
  if (!locallyDone && status?.completionUnread !== true) return 'idle'
  return locallyDone || !read ? 'completed' : 'idle'
}

/**
 * Order cards newest first, with the Session id as a stable tie-break.
 * @param cards - cards from one column or the search list.
 * @returns the same cards in render order.
 */
export function newestFirst<T extends SessionCard>(cards: T[]): T[] {
  return cards.sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
}

/**
 * Derive the three columns from the live Session list, status snapshot, archive set, and marks.
 *
 * A row is considered only when it is a non-blank ordinary Session that is still listed and not
 * archived. Its status then decides the column, in precedence order: a pending interaction outranks
 * a running turn (the same rule the Session row uses); a running turn outranks an unread completion;
 * and an unread completion that has not been acknowledged goes to **Unread**. Everything left is
 * **Recent**, so a Session stays visible after it is read. Before the status snapshot knows a row,
 * its list-run flag is the fallback — exactly the one the Workspace row uses.
 * @param list - Session Controller list snapshot.
 * @param statuses - unified UI status by Session.
 * @param archivedSessionIds - registry-global archive set.
 * @param locallyCompleted - Sessions the board watched stop while it was mounted. DSH leaves
 *   `completionUnread` false when the Session is still retained as `mainView` behind a global
 *   panel, so the board keeps its own stop observation.
 * @param readAt - completion read marks, keyed by Session, valued by the summary `updatedAt` shown.
 *   A mark at least as new as the row moves an unread completion to Recent.
 * @returns the board, one newest-first list per column.
 */
/** Fold the shared Host status over the browser's own status snapshot. */
function effectiveStatus(status: SessionStatus | undefined, shared: SharedStatus | undefined, sessionId: SessionId): SessionStatus | undefined {
  if (shared === undefined) return status
  const pendingInteraction = status?.pendingInteraction ?? (shared.pending !== null && shared.pending.length > 0
    ? { key: 'shared:' + sessionId, kind: shared.pending, sessionId }
    : undefined)
  return {
    running: status?.running ?? shared.running,
    pendingInteraction,
    completionUnread: shared.unread,
  }
}

/** Read one row's owning node from the federation projection. */
export function sessionNodeOf(list: SessionListState, sessionId: SessionId): SessionNode {
  const values = (list.projectionsBySession[sessionId]?.values
    ?? list.byId[sessionId]?.projectionValues) as Readonly<Record<string, unknown>> | undefined
  const value = values?.['sessionManagerNode']
  if (typeof value === 'object' && value !== null) {
    const node = value as { readonly nodeId?: unknown; readonly name?: unknown; readonly instanceId?: unknown }
    if (typeof node.name === 'string' && node.name.length > 0) {
      return {
        id: typeof node.nodeId === 'string' && node.nodeId.length > 0 ? node.nodeId : undefined,
        name: node.name,
        self: false,
        ...(typeof node.instanceId === 'string' && node.instanceId.length > 0 ? { instanceId: node.instanceId } : {}),
      }
    }
  }
  return SELF_NODE
}

/** Drop the transport title prefix once the node badge carries the same fact. */
export function sessionDisplayTitle(displayTitle: string, node: SessionNode): string {
  const prefix = '[' + node.name + '] '
  return !node.self && displayTitle.startsWith(prefix) ? displayTitle.slice(prefix.length) : displayTitle
}

/** Classify one eligible row into a card, or skip it. */
function classify(
  list: SessionListState,
  statuses: SessionStatusSnapshot,
  archived: ReadonlySet<SessionId>,
  locallyCompleted: ReadonlySet<SessionId>,
  readAt: ReadonlyMap<SessionId, number>,
  sharedStatuses: ReadonlyMap<string, SharedStatus>,
  sessionId: SessionId,
): PinnedCard | undefined {
  const row = list.byId[sessionId]
  if (row === undefined || row.blank || row.origin === 'subagent' || archived.has(sessionId)) return undefined
  const shared = sharedStatuses.get(sessionId)
  const effective = effectiveStatus(statuses.get(sessionId), shared, sessionId)
  const state = sessionState(
    effective,
    effective?.running ?? row.running,
    shared === undefined ? (readAt.get(sessionId) ?? Number.NEGATIVE_INFINITY) >= row.updatedAt : !shared.unread,
    locallyCompleted.has(sessionId) && (shared === undefined || shared.unread),
  )
  const node = sessionNodeOf(list, sessionId)
  return {
    id: sessionId,
    title: sessionDisplayTitle(row.displayTitle, node),
    cwd: row.cwd,
    updatedAt: row.updatedAt,
    waitingKind: effective?.pendingInteraction?.kind,
    node,
    state,
  }
}

export function deriveBoard(
  list: SessionListState,
  statuses: SessionStatusSnapshot,
  archivedSessionIds: readonly SessionId[],
  locallyCompleted: ReadonlySet<SessionId> = new Set(),
  readAt: ReadonlyMap<SessionId, number> = new Map(),
  sharedStatuses: ReadonlyMap<string, SharedStatus> = new Map(),
): SessionBoard {
  const archived = new Set(archivedSessionIds)
  const running: SessionCard[] = []
  const unread: SessionCard[] = []
  const recent: SessionCard[] = []

  for (const id of list.ids) {
    const card = classify(list, statuses, archived, locallyCompleted, readAt, sharedStatuses, id)
    if (card === undefined) continue
    if (card.state === 'waiting' || card.state === 'completed') unread.push(card)
    else if (card.state === 'running') running.push(card)
    else recent.push(card)
  }

  return {
    running: newestFirst(running),
    unread: newestFirst(unread),
    recent: newestFirst(recent),
  }
}

/**
 * Build cards for pinned Sessions, in pin order.
 *
 * A pinned Session stays at the top even when it is idle or already read, so this reads the whole
 * listed set rather than one column. Archived, blank, and subagent rows are skipped. A completion
 * still counts after the Session was opened from the board only when it is in `locallyCompleted`;
 * otherwise an up-to-date read mark turns the label to idle.
 * @param list - Session Controller list snapshot.
 * @param statuses - unified UI status by Session.
 * @param archivedSessionIds - registry-global archive set.
 * @param pinnedSessionIds - Host pin set, most recently pinned first.
 * @param readAt - completion read marks, keyed by Session, valued by the summary `updatedAt` shown.
 * @param locallyCompleted - stops the board observed itself and has not acknowledged.
 * @returns pinned cards in Host pin order.
 */
export function derivePinned(
  list: SessionListState,
  statuses: SessionStatusSnapshot,
  archivedSessionIds: readonly SessionId[],
  pinnedSessionIds: readonly SessionId[],
  readAt: ReadonlyMap<SessionId, number> = new Map(),
  locallyCompleted: ReadonlySet<SessionId> = new Set(),
  sharedStatuses: ReadonlyMap<string, SharedStatus> = new Map(),
): PinnedCard[] {
  const archived = new Set(archivedSessionIds)
  const seen = new Set<SessionId>()
  const cards: PinnedCard[] = []

  for (const id of pinnedSessionIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const card = classify(list, statuses, archived, locallyCompleted, readAt, sharedStatuses, id)
    if (card !== undefined) cards.push(card)
  }

  return cards
}

/** One node's column on the Nodes tab. */
export interface NodeColumn {
  readonly node: SessionNode
  /** Pinned Sessions, in Host pin order. */
  readonly pinned: readonly PinnedCard[]
  /** Every other Session, newest first. */
  readonly rest: readonly PinnedCard[]
}

/**
 * Group every eligible Session under its owning node for the Nodes tab.
 *
 * Pinned Sessions stay at the top of their own node column; the rest are newest first. Nodes are
 * ordered with this host first, then by their newest Session.
 * @param list - Session Controller list snapshot.
 * @param statuses - unified UI status by Session.
 * @param archivedSessionIds - registry-global archive set.
 * @param pinnedSessionIds - Host pin set, most recently pinned first.
 * @param readAt - completion read marks.
 * @param locallyCompleted - stops the board observed and has not acknowledged.
 * @param sharedStatuses - shared Host status by Session.
 * @returns one column per node that has at least one eligible Session.
 */
export function deriveNodeColumns(
  list: SessionListState,
  statuses: SessionStatusSnapshot,
  archivedSessionIds: readonly SessionId[],
  pinnedSessionIds: readonly SessionId[],
  readAt: ReadonlyMap<SessionId, number> = new Map(),
  locallyCompleted: ReadonlySet<SessionId> = new Set(),
  sharedStatuses: ReadonlyMap<string, SharedStatus> = new Map(),
): NodeColumn[] {
  const archived = new Set(archivedSessionIds)
  const pinned = new Map<SessionId, number>()
  pinnedSessionIds.forEach((id, index) => {
    if (!pinned.has(id)) pinned.set(id, index)
  })
  const buckets = new Map<string, { node: SessionNode; pinned: PinnedCard[]; rest: PinnedCard[]; activity: number }>()

  for (const id of list.ids) {
    const card = classify(list, statuses, archived, locallyCompleted, readAt, sharedStatuses, id)
    if (card === undefined) continue
    const key = card.node.self ? 'self' : card.node.id ?? 'name:' + card.node.name
    const bucket = buckets.get(key) ?? { node: card.node, pinned: [], rest: [], activity: 0 }
    bucket.activity = Math.max(bucket.activity, card.updatedAt)
    if (pinned.has(id)) bucket.pinned.push(card)
    else bucket.rest.push(card)
    buckets.set(key, bucket)
  }

  const columns = [...buckets.values()].map((bucket) => ({
    node: bucket.node,
    pinned: bucket.pinned.sort((left, right) => (pinned.get(left.id) ?? 0) - (pinned.get(right.id) ?? 0)),
    rest: newestFirst(bucket.rest),
    activity: bucket.activity,
  }))
  columns.sort((left, right) => {
    if (left.node.self !== right.node.self) return left.node.self ? -1 : 1
    if (left.activity !== right.activity) return right.activity - left.activity
    return left.node.name.localeCompare(right.node.name)
  })
  return columns.map(({ node, pinned: pinnedCards, rest }) => ({ node, pinned: pinnedCards, rest }))
}
