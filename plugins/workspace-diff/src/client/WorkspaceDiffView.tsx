/**
 * The Conversation view: the workspace's uncommitted changes as a tree.
 *
 * The diff itself does not live here. Picking a file opens it in the right Sidebar through this
 * plugin's own tab type, so the container that already owns tab chips, resizing, closing and
 * persistence owns it here too, and this tab stays a navigation surface.
 *
 * The tree refreshes on a debounce after any observed write; every request and the watch are tied to
 * the view's own AbortController, so switching Session or closing the tab ends both.
 * @module dsh-plugin-workspace-diff/client/WorkspaceDiffView
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangesOutcome, ChangedFileView, WorkspaceDiffApi } from './api.ts'
import { FileTree } from './FileTree.tsx'
import type { WorkspaceDiffKey } from './locales.ts'
import { reasonMessage } from './messages.ts'
import { buildFileTree } from './tree.ts'
import css from './WorkspaceDiffView.module.css'

/** How long after the last observed write the tree is refetched. */
const REFRESH_DEBOUNCE_MS = 150

/** What the registration injects into the component. */
export interface WorkspaceDiffInjected {
  /** The changes route and the file watch, bound to this Session. */
  readonly api: WorkspaceDiffApi
  /** Open one repository-relative path's diff in the right Sidebar. */
  readonly openDiff: (path: string) => void
  /** Translate one key of this view's namespace. */
  readonly t: (key: WorkspaceDiffKey) => string
}

/** The component's props: the slot's own, plus what the registration injects. */
type ViewProps = PropsRuntime<'conversation.view'> & WorkspaceDiffInjected

/**
 * Render the Changes view.
 * @param props - the slot's props and the injected data access.
 * @returns the header and the changed-file tree.
 */
export function WorkspaceDiffView({ api, openDiff, t }: ViewProps): ReactNode {
  const [changes, setChanges] = useState<ChangesOutcome | undefined>(undefined)
  const [revision, setRevision] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    api.loadChanges(controller.signal).then(
      (result) => { if (!controller.signal.aborted) setChanges(result) },
      () => { if (!controller.signal.aborted) setChanges({ ok: false, reason: 'unknown' }) },
    )
    return () => { controller.abort() }
  }, [api, revision])

  useEffect(() => {
    const controller = new AbortController()
    api.watch(() => {
      if (timer.current !== undefined) clearTimeout(timer.current)
      timer.current = setTimeout(() => { setRevision((value) => value + 1) }, REFRESH_DEBOUNCE_MS)
    }, controller.signal)
    return () => {
      controller.abort()
      if (timer.current !== undefined) {
        clearTimeout(timer.current)
        timer.current = undefined
      }
    }
  }, [api])

  const files: readonly ChangedFileView[] = useMemo(
    () => (changes?.ok === true ? changes.files : []),
    [changes],
  )
  const nodes = useMemo(() => buildFileTree(files), [files])
  // Counts a file could not be given (binary, past the untracked cap) stay out of the total rather
  // than counting as zero.
  const totals = files.reduce(
    (sum, file) => ({
      added: sum.added + (file.added ?? 0),
      removed: sum.removed + (file.removed ?? 0),
    }),
    { added: 0, removed: 0 },
  )

  return (
    <div className={css.view}>
      <div className={css.header}>
        <span className={css.repo} title={changes?.ok === true ? changes.repoRoot : undefined}>
          {changes?.ok === true ? changes.repoRoot : t('view.label')}
        </span>
        {files.length > 0 ? (
          <span className={css.summary}>
            <span className={css.added}>{'+' + totals.added}</span>
            <span className={css.deleted}>{'-' + totals.removed}</span>
          </span>
        ) : null}
        <button
          type="button"
          className={css.refresh}
          onClick={() => { setRevision((value) => value + 1) }}
        >
          {t('actions.refresh')}
        </button>
      </div>
      {changes === undefined ? <p className={css.note}>{t('state.loading')}</p> : null}
      {changes !== undefined && !changes.ok ? <p className={css.note}>{reasonMessage(t, changes.reason)}</p> : null}
      {changes?.ok === true && files.length === 0 ? <p className={css.note}>{t('list.empty')}</p> : null}
      {files.length > 0 ? (
        <div className={css.treePane}>
          <FileTree nodes={nodes} onOpen={openDiff} t={t} />
        </div>
      ) : null}
    </div>
  )
}
