/**
 * The session board and its full-screen conversation preview.
 *
 * The board is three columns over the live runtime state of every listed Session. A card opens a
 * preview *inside this page*: the native Conversation is embedded through the shared
 * `conversation.content` Factory, bound to a retained Session reference, so the composer and the
 * native question/approval takeovers travel with it. A back bar returns to the board; no Session
 * navigation happens.
 * @module dsh-plugin-session-manager/client/page
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconChevronLeftOutlineRegular,
  IconCloseOutlineRegular,
  Modal,
  relativeTime,
  StateDot,
  type StateDotState,
  type RelativeTimeUnit,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: each carries the declaration merges for the global hooks and the `main` slot row.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import {
  BOARD_COLUMNS,
  deriveBoard,
  previewMode,
  visibleCompleted,
  waitingCopyKey,
  type BoardColumn,
  type SessionCard,
} from './board.ts'
import { NS, type SessionManagerKey } from './locales.ts'
import { CONVERSATION_SLOT } from './slots.ts'
import css from './SessionBoard.module.css'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** The board's preview subpage, which deliberately is not the main view. */
    sessionManager: unknown
  }
}

/** The one action the board needs; the registration injects it from `ctx.sessions`. */
export interface SessionManagerInjected {
  /** Retain one Session for the preview; the page releases the reference when the preview closes. */
  readonly retainSession: (sessionId: SessionId) => SessionReference
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
  readonly id: SessionId
  readonly title: string
  readonly reference: SessionReference
  /** A waiting Session opens the question dialog; every other card opens the full page. */
  readonly mode: 'dialog' | 'page'
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
}

/**
 * Render the waiting Session's native Conversation in a dialog.
 *
 * The native question card lives in the Conversation composer chain, so the same embedded Factory
 * that fills the full preview puts the card at the bottom of this dialog. The bar names why the
 * Session waits and offers the full page for context.
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
}: PreviewDialogProps): ReactNode {
  return (
    <Modal open onClose={onClose} title={title} headless className={css.dialog ?? ''}>
      <div className={css.dialogFrame}>
        <header className={css.dialogBar}>
          <div className={css.dialogHeading}>
            {waitingKind !== undefined && (
              <span className={css.dialogEyebrow}>{t(waitingCopyKey(waitingKind))}</span>
            )}
            <span className={css.dialogTitle} title={title}>{title}</span>
          </div>
          <button type="button" className={css.dialogAction} onClick={onOpenPage}>
            {t('preview.openPage')}
          </button>
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
 * Preview-local read marks.
 *
 * DSH clears `completionUnread` only when a Session is retained as `mainView`; a preview is not
 * that. Showing a completion in the preview therefore records the summary `updatedAt` it showed,
 * and the completed column hides that card until newer activity makes it current again. The map is
 * module-level on purpose: navigating to another panel unmounts the page, and the mark must survive
 * that round trip. It is still only browser-local, like DSH's own completion reminder.
 */
const previewedAt = new Map<SessionId, number>()

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
 * Render the board, or the preview subpage when a card is open.
 * @param props - main-slot standard props, the preview child, translate seat, and retention.
 * @returns the board page or its full-screen conversation preview.
 */
export function SessionBoardPage(props: PageProps): ReactNode {
  const {
    useSessions,
    useSessionStatus,
    useWorkspaces,
    retainSession,
    SessionProvider,
    renderSlot,
    t,
  } = props
  const list = useSessions((state) => state)
  const statuses = useSessionStatus((state) => state)
  const archived = useWorkspaces((state) => state.archivedSessionIds)
  const [now, setNow] = useState(() => Date.now())
  const [preview, setPreview] = useState<Preview | undefined>(undefined)
  const [previewError, setPreviewError] = useState<string | undefined>(undefined)
  const [, bumpReadRevision] = useState(0)

  // Relative labels are the only clock-dependent copy on the page. A slow tick keeps them honest
  // without re-deriving the board, which only changes when Session state does. The tick pauses while
  // the native Conversation is mounted, so the preview is not re-rendered by an unrelated clock.
  useEffect(() => {
    if (preview !== undefined) return undefined
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 30_000)
    return () => {
      clearInterval(timer)
    }
  }, [preview])

  // The preview owns one retained Session reference. Releasing it in the effect cleanup runs after
  // the Conversation for the old reference has unmounted, including when the page itself unmounts.
  const previewReference = preview?.reference
  useEffect(() => {
    if (previewReference === undefined) return
    return () => {
      previewReference.release()
    }
  }, [previewReference])

  const board = useMemo(
    () => deriveBoard(list, statuses, archived),
    [list, statuses, archived],
  )
  const completed = visibleCompleted(board.completed, previewedAt)

  // A completion read in the preview is read even though DSH's mainView marker is untouched. Mark
  // the exact summary timestamp the preview showed, so newer activity brings the card back.
  useEffect(() => {
    if (preview === undefined) return
    const row = list.byId[preview.id]
    if (row === undefined || statuses.get(preview.id)?.completionUnread !== true) return
    if ((previewedAt.get(preview.id) ?? Number.NEGATIVE_INFINITY) >= row.updatedAt) return
    previewedAt.set(preview.id, row.updatedAt)
    bumpReadRevision((value) => value + 1)
  }, [preview, statuses, list, bumpReadRevision])

  const total = board.running.length + board.waiting.length + completed.length

  /**
   * Retain one Session and open the preview surface its column calls for.
   * @param card - the clicked card.
   * @param column - the column that owns the card.
   */
  function openPreview(card: SessionCard, column: BoardColumn): void {
    setPreviewError(undefined)
    try {
      const reference = retainSession(card.id)
      setPreview({
        id: card.id,
        title: card.title,
        reference,
        mode: previewMode(column),
      })
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  /** Leave the preview; its effect cleanup releases the retained reference. */
  function closePreview(): void {
    setNow(Date.now())
    setPreview(undefined)
  }

  /** Keep the retained Session and expand the question dialog into the full preview page. */
  function openPage(): void {
    setPreview((current) => current === undefined ? current : { ...current, mode: 'page' })
  }

  const previewTitle = preview === undefined
    ? ''
    : list.byId[preview.id]?.displayTitle ?? preview.title

  if (preview !== undefined && preview.mode === 'page') {
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
          <div className={css.heading}>
            <h1 className={css.title}>{t('page.title')}</h1>
            <p className={css.description}>{t('page.description')}</p>
          </div>
          {total > 0 && <span className={css.total}>{t('page.count', { count: total })}</span>}
        </header>

        {previewError !== undefined && (
          <p className={css.previewError} role="alert">
            {t('preview.failed')}: {previewError}
          </p>
        )}

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
              const cards = column === 'completed' ? completed : board[column]
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
                                openPreview(card, column)
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
      {preview !== undefined && preview.mode === 'dialog' && (
        <PreviewDialog
          preview={preview}
          title={previewTitle}
          waitingKind={statuses.get(preview.id)?.pendingInteraction?.kind}
          t={t}
          SessionProvider={SessionProvider}
          renderSlot={renderSlot}
          onClose={closePreview}
          onOpenPage={openPage}
        />
      )}
    </>
  )
}
