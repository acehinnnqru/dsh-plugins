/**
 * Presentation helpers shared by the board cards, the search dialog, and the management list.
 *
 * These were page-local until the management tab needed the same labels. Keeping them apart from
 * React lets every surface name a Session the same way — Workspace title (or directory basename),
 * runtime state, and relative activity time — and keeps the page focused on composition.
 * @module dsh-plugin-session-manager/client/session-view
 */

import { relativeTime, type RelativeTimeUnit } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { waitingCopyKey, type PinnedState, type SessionCard } from './board.ts'
import { NS, type SessionManagerKey } from './locales.ts'
import {
  DEFAULT_WORKSPACE_TITLE,
  baseName,
  workspaceLabel,
  workspaceOf,
} from './workspace-search.ts'

/** This namespace's translate function. */
export type Translate = PropsLocale<typeof NS>['t']

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
 * @param state - the card's runtime state.
 * @param card - the card whose waiting kind may refine the label.
 * @param t - this namespace's translate function.
 * @returns the visible state text.
 */
export function stateText(state: PinnedState, card: SessionCard, t: Translate): string {
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
export function timeText(at: number, now: number, t: Translate): string {
  const bucket = relativeTime(at, now)
  return t(TIME_COPY[bucket.unit], { n: bucket.n })
}

/**
 * Resolve the visible Workspace name for a Session.
 *
 * A Session outside every Workspace falls back to its directory basename, and the product's
 * default marker is localized.
 * @param card - Session card.
 * @param items - Workspace rows.
 * @param t - this namespace's translate function.
 * @returns the Workspace name, or an empty string without a cwd.
 */
export function workspaceName(
  card: SessionCard,
  items: readonly WorkspaceView[],
  t: Translate,
): string {
  const workspace = workspaceOf(card, items)
  if (workspace === undefined) return card.cwd === undefined ? '' : baseName(card.cwd)
  const label = workspaceLabel(workspace)
  return label === DEFAULT_WORKSPACE_TITLE ? t('workspace.default') : label
}

/**
 * Full timestamp for a card's tooltip.
 * @param at - epoch ms.
 * @returns the reader's localized date and time.
 */
export function fullDate(at: number): string {
  return new Date(at).toLocaleString()
}
