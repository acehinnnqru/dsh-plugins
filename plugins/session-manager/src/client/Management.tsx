/**
 * The management tab: every eligible Session in one selectable list, with batch archiving.
 *
 * The list is the same full-listed set the search dialog filters — not the board's Recent window —
 * so an older Session stays reachable. Selection is local to the tab; each row still opens the
 * board's preview dialog, which is what keeps a running Session inspectable before it is archived.
 * @module dsh-plugin-session-manager/client/management-tab
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  Button,
  IconArchiveOutlineRegular,
  IconSearchOutlineRegular,
  Input,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { archiveSessions } from './archive.ts'
import { matchSessions, type SessionHit } from './session-search.ts'
import { fullDate, stateText, timeText, workspaceName, type Translate } from './session-view.ts'
import css from './SessionBoard.module.css'

/** Props of the management tab. */
export interface ManagementProps {
  /** Every eligible listed Session, newest first. */
  readonly sessions: readonly SessionHit[]
  /** Workspace rows, used for the row hint. */
  readonly workspaces: readonly WorkspaceView[]
  /** Current epoch ms, so relative labels stay honest without local clocks. */
  readonly now: number
  /** This namespace's translate function. */
  readonly t: Translate
  /** Archive one Session on the Host. */
  readonly archiveSession: (sessionId: SessionId) => Promise<void>
  /** Open one row in the board's preview dialog. */
  readonly onPreview: (hit: SessionHit) => void
}

/**
 * Render the management list, its filter, its selection, and the archive confirmation.
 * @param props - the listed Sessions, Workspaces, clock, copy, and two actions.
 * @returns the management panel.
 */
export function Management({
  sessions,
  workspaces,
  now,
  t,
  archiveSession,
  onPreview,
}: ManagementProps): ReactNode {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<SessionId>>(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(0)
  const selectAll = useRef<HTMLInputElement>(null)
  const archiving = useRef(false)

  const results = matchSessions(sessions, query, workspaces)
  // A selection can outlive the row it named (archived here or in the native sidebar); only the
  // listed ids count, so the toolbar and the batch never act on a ghost.
  const available = new Set(sessions.map((hit) => hit.id))
  const chosen = new Set([...selected].filter((id) => available.has(id)))
  const chosenVisible = results.filter((hit) => chosen.has(hit.id)).length
  const allVisible = results.length > 0 && chosenVisible === results.length

  // The native checkbox exposes the partial state only through its DOM property.
  useEffect(() => {
    if (selectAll.current !== null) {
      selectAll.current.indeterminate = chosenVisible > 0 && chosenVisible < results.length
    }
  }, [chosenVisible, results.length])

  /**
   * Add or remove one row.
   * @param sessionId - row to change.
   * @param next - whether the row is selected.
   */
  function setRow(sessionId: SessionId, next: boolean): void {
    setSelected((current) => {
      const updated = new Set(current)
      if (next) updated.add(sessionId)
      else updated.delete(sessionId)
      return updated
    })
  }

  /**
   * Select or clear every filtered row, leaving filtered-out selection alone.
   * @param next - whether the filtered rows are selected.
   */
  function setVisible(next: boolean): void {
    setSelected((current) => {
      const updated = new Set(current)
      for (const hit of results) {
        if (next) updated.add(hit.id)
        else updated.delete(hit.id)
      }
      return updated
    })
  }

  /**
   * Archive the current selection, then drop the accepted rows from it.
   *
   * Refused rows stay listed and selected so the user can inspect them; the tab reports the count.
   */
  async function runArchive(): Promise<void> {
    const ids = [...chosen]
    // A double click must not start the same batch twice; the state flag only governs the UI.
    if (ids.length === 0 || archiving.current) return
    archiving.current = true
    setConfirming(false)
    setBusy(true)
    setFailed(0)
    try {
      const outcome = await archiveSessions(ids, archiveSession)
      setSelected((current) => {
        const updated = new Set(current)
        for (const sessionId of outcome.archived) updated.delete(sessionId)
        return updated
      })
      setFailed(outcome.failed.length)
    } finally {
      archiving.current = false
      setBusy(false)
    }
  }

  return (
    <section className={css.management} aria-label={t('tab.management')}>
      <div className={css.manageBar}>
        <Input
          className={css.manageFilter ?? ''}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value)
          }}
          placeholder={t('manage.filter')}
          aria-label={t('manage.filter')}
          icon={<IconSearchOutlineRegular size={16} />}
          spellCheck={false}
          autoComplete="off"
        />
        <label className={css.manageSelectAll}>
          <input
            ref={selectAll}
            type="checkbox"
            className={css.manageCheck}
            checked={allVisible}
            disabled={busy || results.length === 0}
            onChange={(event) => {
              setVisible(event.currentTarget.checked)
            }}
          />
          <span>{t('manage.selectAll')}</span>
        </label>
        <span className={css.manageSelected}>{t('manage.selected', { count: chosen.size })}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={css.manageArchive}
          icon={<IconArchiveOutlineRegular size={14} />}
          disabled={busy || chosen.size === 0}
          aria-busy={busy}
          onClick={() => {
            setFailed(0)
            setConfirming(true)
          }}
        >
          {t('manage.archive', { count: chosen.size })}
        </Button>
      </div>

      {failed > 0 && (
        <p className={css.manageError} role="alert">
          {t('manage.failed', { count: failed })}
        </p>
      )}

      {results.length === 0
        ? (
          <p className={css.manageEmpty}>
            {t(sessions.length === 0 ? 'manage.emptyAll' : 'manage.empty')}
          </p>
        )
        : (
          <ul className={css.manageList}>
            {results.map((hit) => {
              const workspace = workspaceName(hit, workspaces, t)
              return (
                <li
                  key={hit.id}
                  className={css.manageRow}
                  data-selected={chosen.has(hit.id) ? 'true' : undefined}
                >
                  <input
                    type="checkbox"
                    className={css.manageCheck}
                    checked={chosen.has(hit.id)}
                    disabled={busy}
                    aria-label={t('manage.selectOne', { title: hit.title })}
                    onChange={(event) => {
                      setRow(hit.id, event.currentTarget.checked)
                    }}
                  />
                  <button
                    type="button"
                    className={css.manageRowBody}
                    title={hit.title}
                    onClick={() => {
                      onPreview(hit)
                    }}
                  >
                    <span className={css.manageRowTitle}>{hit.title}</span>
                    <span className={css.manageRowMeta}>
                      {workspace !== '' && (
                        <span className={css.manageRowWorkspace}>{workspace}</span>
                      )}
                      <span className={css.manageRowState}>{stateText(hit.state, hit, t)}</span>
                      <span className={css.manageRowTime} title={fullDate(hit.updatedAt)}>
                        {timeText(hit.updatedAt, now, t)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

      {confirming && (
        <Modal
          open
          onClose={() => {
            setConfirming(false)
          }}
          title={t('manage.confirmTitle')}
          closeLabel={t('preview.close')}
          description={t('manage.confirmBody', { count: chosen.size })}
          footer={(
            <>
              <Button
                type="button"
                variant="ghost"
                {...{ 'data-modal-autofocus': true }}
                onClick={() => {
                  setConfirming(false)
                }}
              >
                {t('manage.cancel')}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={busy}
                onClick={() => {
                  void runArchive()
                }}
              >
                {t('manage.confirm')}
              </Button>
            </>
          )}
        />
      )}
    </section>
  )
}
