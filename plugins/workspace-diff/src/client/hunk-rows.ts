/**
 * Numbering a served hunk the way the shipped review tab numbers it.
 *
 * Pure: the input is one hunk of git's text and the output is the rows to draw, so the counting is
 * testable without a DOM. Context lines count on both sides, a deletion counts on the old side, an
 * addition on the new one, and git's own no-newline note takes no number at all.
 * @module dsh-plugin-workspace-diff/client/hunk-rows
 */

import type { DiffHunkView } from './api.ts'

/** What one drawn line is. */
export type HunkRowKind = 'add' | 'del' | 'context' | 'note'

/** One drawn line with its two line numbers. */
export interface HunkRow {
  /** The line's role, which decides its colour and its sign. */
  readonly kind: HunkRowKind
  /** The old-file line number, or null for a line that only exists on the new side. */
  readonly oldLine: number | null
  /** The new-file line number, or null for a line that only exists on the old side. */
  readonly newLine: number | null
  /** The line's text, without its leading marker. */
  readonly text: string
}

/**
 * Number one hunk's lines.
 * @param hunk - a hunk as the route served it.
 * @returns the rows in order.
 */
export function hunkRows(hunk: DiffHunkView): HunkRow[] {
  let oldLine = hunk.oldStart
  let newLine = hunk.newStart
  return hunk.lines.map((line) => {
    const text = line.slice(1)
    switch (line.at(0)) {
      case '+': return { kind: 'add', oldLine: null, newLine: newLine++, text }
      case '-': return { kind: 'del', oldLine: oldLine++, newLine: null, text }
      case '\\': return { kind: 'note', oldLine: null, newLine: null, text: line }
      default: return { kind: 'context', oldLine: oldLine++, newLine: newLine++, text }
    }
  })
}
