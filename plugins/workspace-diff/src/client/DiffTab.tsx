/**
 * The right Sidebar body: one changed file's comparison.
 *
 * The comparison is git's own hunks, numbered the way the shipped review tab numbers them (old
 * number, new number, sign, text) — the same surface a reader already knows from the per-turn
 * review — rather than a second, differently-shaped diff renderer.
 *
 * The container owns the tab chip, its title, closing, resizing and persistence; this component owns
 * only the content. The address it was opened at carries the Session and the path, and the tab's own
 * signal ends the request when the tab closes.
 * @module dsh-plugin-workspace-diff/client/DiffTab
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { IconWrapLinesOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { parseDiffAddress } from './address.ts'
import type { DiffOutcome, WorkspaceDiffApi } from './api.ts'
import { DiffHunks } from './DiffHunks.tsx'
import type { WorkspaceDiffKey } from './locales.ts'
import { countLabel, reasonMessage } from './messages.ts'
import css from './WorkspaceDiffView.module.css'

/** What the registration injects into the tab body. */
export interface DiffTabInjected {
  /** The route access bound to one Session. */
  readonly apiFor: (sessionId: string) => WorkspaceDiffApi
  /** Whether this tab opens with line wrapping already on. */
  readonly defaultWrap: boolean
  /** Translate one key of this view's namespace. */
  readonly t: (key: WorkspaceDiffKey) => string
}

/** The body's props: the tab container's own, plus what the registration injects. */
type DiffTabProps = PropsRuntime<'sidebar.right.pane.tab'> & DiffTabInjected

/**
 * Render one file's comparison.
 * @param props - composed slot props.
 * @returns the diff, or the state that stands in for it.
 */
export function DiffTab({ useTabInfo, apiFor, defaultWrap, t }: DiffTabProps): ReactNode {
  const { tab } = useTabInfo()
  const parsed = useMemo(() => parseDiffAddress(tab.contentId), [tab.contentId])
  const api = useMemo(() => (parsed === undefined ? undefined : apiFor(parsed.sessionId)), [apiFor, parsed])
  const [diff, setDiff] = useState<DiffOutcome | undefined>(undefined)
  const [revision, setRevision] = useState(0)
  const [wrap, setWrap] = useState(defaultWrap)

  // The frame's absolute path ends with this tab's repository-relative one, so a write to this file
  // refreshes the pane without the tab ever learning the repository root.
  useEffect(() => {
    if (api === undefined || parsed === undefined) return
    const controller = new AbortController()
    api.watch((change) => {
      if (!change.absolutePath.endsWith('/' + parsed.path)) return
      setRevision((value) => value + 1)
    }, controller.signal)
    return () => { controller.abort() }
  }, [api, parsed])

  useEffect(() => {
    if (api === undefined || parsed === undefined) return
    const controller = new AbortController()
    const abort = (): void => { controller.abort() }
    tab.signal.addEventListener('abort', abort, { once: true })
    api.loadDiff(parsed.path, controller.signal).then(
      (result) => { if (!controller.signal.aborted) setDiff(result) },
      () => { if (!controller.signal.aborted) setDiff({ ok: false, reason: 'unknown' }) },
    )
    return () => {
      tab.signal.removeEventListener('abort', abort)
      controller.abort()
    }
  }, [api, parsed, revision, tab.signal])

  if (parsed === undefined) return <p className={css.note}>{t('state.unknown')}</p>

  const body = (): ReactNode => {
    if (diff === undefined) return <p className={css.note}>{t('state.loading')}</p>
    if (!diff.ok) return <p className={css.note}>{reasonMessage(t, diff.reason)}</p>
    if (diff.hunks.length === 0) return <p className={css.note}>{t('diff.empty')}</p>
    return (
      <>
        {diff.truncated ? <p className={css.notice}>{t('diff.truncated')}</p> : null}
        <DiffHunks hunks={diff.hunks} />
      </>
    )
  }

  return (
    <div className={css.tabBody}>
      <div className={css.tabHeader} title={parsed.path}>
        <span className={css.tabPath}>{parsed.path}</span>
        {diff?.ok === true ? (
          <span className={css.tabCounts}>
            <span className={css.added}>{'+' + countLabel(diff.added)}</span>
            <span className={css.deleted}>{'-' + countLabel(diff.removed)}</span>
          </span>
        ) : null}
        <Tooltip label={t(wrap ? 'diff.nowrap' : 'diff.wrap')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.tool}
            aria-pressed={wrap}
            aria-label={t('diff.wrapAria')}
            onClick={() => { setWrap((value) => !value) }}
          >
            <IconWrapLinesOutline16 />
          </button>
        </Tooltip>
      </div>
      <div className={css.diffScroll} data-wrap={wrap || undefined}>{body()}</div>
    </div>
  )
}
