/**
 * The session board: three columns over the live runtime state of every listed Session.
 *
 * The page owns no state beyond the wall clock used for relative times. Session data and status are
 * read through the global hooks the main slot already supplies, and a card only asks the Workspace
 * navigation service to open its Session — which is also what marks a completion read and removes
 * the card from the board.
 * @module dsh-plugin-session-manager/client/page
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  relativeTime,
  StateDot,
  type StateDotState,
  type RelativeTimeUnit,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: each carries the declaration merges for the global hooks and the `main` slot row.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { BOARD_COLUMNS, deriveBoard, waitingCopyKey, type BoardColumn, type SessionCard } from './board.ts'
import { NS, type SessionManagerKey } from './locales.ts'
import css from './SessionBoard.module.css'

/** The one navigation verb the board needs; the registration injects it from `ctx.uiWorkspace`. */
export interface SessionManagerInjected {
  /** Show one Session's Conversation in the main column. */
  readonly openSession: (sessionId: SessionId) => void
}

/** The main slot's props, this namespace's translate seat, and the injected navigation verb. */
type PageProps = PropsRuntime<'main'> & PropsLocale<typeof NS> & InjectFace<SessionManagerInjected>

/** The page's translate function. */
type Translate = PageProps['t']

/** Per-column copy and the state dot it leads with. */
interface ColumnCopy {
  readonly title: SessionManagerKey
  readonly empty: SessionManagerKey
  readonly dot: StateDotState
}

/** Column copy, in the same order as {@link BOARD_COLUMNS}. */
const COLUMN_COPY: Record<BoardColumn, ColumnCopy> = {
  running: { title: 'column.running', empty: 'column.running.empty', dot: 'ongoing' },
  waiting: { title: 'column.waiting', empty: 'column.waiting.empty', dot: 'warning' },
  completed: { title: 'column.completed', empty: 'column.completed.empty', dot: 'done' },
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
function stateText(column: BoardColumn, card: SessionCard, t: Translate): string {
  if (column === 'waiting') return t(waitingCopyKey(card.waitingKind))
  return column === 'running' ? t('card.running') : t('card.completed')
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

/**
 * Render the session board.
 * @param props - main-slot standard props, translate seat, and the open callback.
 * @returns the board page.
 */
export function SessionBoardPage(props: PageProps): ReactNode {
  const { useSessions, useSessionStatus, useWorkspaces, openSession, t } = props
  const list = useSessions((state) => state)
  const statuses = useSessionStatus((state) => state)
  const archived = useWorkspaces((state) => state.archivedSessionIds)
  const [now, setNow] = useState(() => Date.now())

  // Relative labels are the only clock-dependent copy on the page. A slow tick keeps them honest
  // without re-deriving the board, which only changes when Session state does.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 30_000)
    return () => {
      clearInterval(timer)
    }
  }, [])

  const board = useMemo(
    () => deriveBoard(list, statuses, archived),
    [list, statuses, archived],
  )
  const total = board.running.length + board.waiting.length + board.completed.length

  return (
    <div className={css.page}>
      <div className={css.content}>
        <header className={css.header}>
          <div className={css.heading}>
            <h1 className={css.title}>{t('page.title')}</h1>
            <p className={css.description}>{t('page.description')}</p>
          </div>
          {total > 0 && <span className={css.total}>{t('page.count', { count: total })}</span>}
        </header>

        {total === 0 && list.phase === 'pending' && (
          <p className={css.loading} role="status">{t('state.loading')}</p>
        )}

        {total === 0 && list.phase === 'ready' && (
          <p className={css.emptyHint}>
            <strong>{t('state.empty')}</strong>
            <span>{t('state.emptyHint')}</span>
          </p>
        )}

        {(total > 0 || list.phase === 'ready') && (
          <div className={css.board}>
            {BOARD_COLUMNS.map((column) => {
              const cards = board[column]
              const meta = COLUMN_COPY[column]
              return (
                <section
                  className={css.column}
                  key={column}
                  data-column={column}
                  aria-labelledby={`session-manager-${column}`}
                >
                  <header className={css.columnHead}>
                    <StateDot state={meta.dot} />
                    <h2 className={css.columnTitle} id={`session-manager-${column}`}>{t(meta.title)}</h2>
                    <span className={css.columnCount}>{cards.length}</span>
                  </header>
                  {cards.length === 0
                    ? <p className={css.columnEmpty}>{t(meta.empty)}</p>
                    : (
                      <ul className={css.cards}>
                        {cards.map((card) => (
                          <li key={card.id}>
                            <button
                              type="button"
                              className={css.card}
                              onClick={() => {
                                openSession(card.id)
                              }}
                            >
                              <span className={css.cardTitle} title={card.title}>{card.title}</span>
                              <span className={css.cardLine}>
                                <span className={css.cardState}>{stateText(column, card, t)}</span>
                                <span className={css.time} title={fullDate(card.updatedAt)}>
                                  {timeText(card.updatedAt, now, t)}
                                </span>
                              </span>
                              {card.cwd !== undefined && (
                                <span className={css.cwd} title={card.cwd}>{baseName(card.cwd)}</span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
