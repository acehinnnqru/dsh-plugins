import { describe, expect, it } from 'vitest'
import { hunkRows } from '../src/client/hunk-rows.ts'

describe('hunkRows', () => {
  it('numbers context, deletions and additions from the hunk starts', () => {
    const rows = hunkRows({
      header: '@@ -94,3 +94,4 @@',
      oldStart: 94,
      newStart: 94,
      lines: [' const a = 1', '-const b = 2', '+const b = 3', '+const c = 4'],
    })

    expect(rows.map((row) => [row.kind, row.oldLine, row.newLine])).toEqual([
      ['context', 94, 94],
      ['del', 95, null],
      ['add', null, 95],
      ['add', null, 96],
    ])
  })

  it('gives git\'s no-newline note no line number', () => {
    const rows = hunkRows({
      header: '@@ -1 +1 @@',
      oldStart: 1,
      newStart: 1,
      lines: ['-a', '\\ No newline at end of file', '+b'],
    })

    expect(rows[1]).toEqual({ kind: 'note', oldLine: null, newLine: null, text: '\\ No newline at end of file' })
    expect(rows[2]).toEqual({ kind: 'add', oldLine: null, newLine: 1, text: 'b' })
  })

  it('reads an empty hunk as no rows', () => {
    expect(hunkRows({ header: '@@ -1 +1 @@', oldStart: 1, newStart: 1, lines: [] })).toEqual([])
  })
})
