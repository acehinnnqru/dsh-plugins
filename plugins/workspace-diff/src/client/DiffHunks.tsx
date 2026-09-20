/**
 * The hunks of one comparison, drawn in the shipped review surface's grid: old number, new number,
 * sign, text, a header per hunk.
 * @module dsh-plugin-workspace-diff/client/DiffHunks
 */

import type { ReactNode } from 'react'
import type { DiffHunkView } from './api.ts'
import { hunkRows, type HunkRowKind } from './hunk-rows.ts'
import css from './WorkspaceDiffView.module.css'

/** The character each row kind shows in the sign column; context and the note keep its width. */
const SIGN: Record<HunkRowKind, string> = { add: '+', del: '-', context: ' ', note: ' ' }

/**
 * Render one comparison.
 * @param props - the hunks to draw.
 * @returns a header and its numbered lines per hunk.
 */
export function DiffHunks({ hunks }: { hunks: readonly DiffHunkView[] }): ReactNode {
  return (
    <>
      {hunks.map((hunk, index) => (
        <div key={index} className={css.hunk}>
          <div className={css.hunkHeader}>{hunk.header}</div>
          {hunkRows(hunk).map((row, rowIndex) => (
            <div
              key={rowIndex}
              className={[css.line, css[row.kind === 'note' ? 'noteLine' : row.kind] ?? ''].filter(Boolean).join(' ')}
            >
              <span className={css.number}>{row.oldLine === null ? '' : row.oldLine}</span>
              <span className={css.number}>{row.newLine === null ? '' : row.newLine}</span>
              <span className={css.sign}>{SIGN[row.kind]}</span>
              <span className={css.text}>{row.text === '' ? ' ' : row.text}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  )
}
