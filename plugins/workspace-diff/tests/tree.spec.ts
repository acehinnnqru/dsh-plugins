import { describe, expect, it } from 'vitest'
import type { ChangedFileView } from '../src/client/api.ts'
import { buildFileTree, type TreeNode } from '../src/client/tree.ts'

/**
 * @param path - a repository-relative path.
 * @returns the route's row for it, with counts that do not matter here.
 */
function file(path: string): ChangedFileView {
  return { path, status: 'M', added: 1, removed: 0 }
}

/**
 * @param nodes - the tree to flatten.
 * @returns every drawn row, prefixed by its kind.
 */
function shape(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((node) => node.kind === 'file'
    ? ['file:' + node.name]
    : ['dir:' + node.name, ...shape(node.children).map(entry => '  ' + entry)])
}

describe('buildFileTree', () => {
  it('collapses the boring middle into the row that matters', () => {
    // a holds one file beside a chain: b exists only for c, so b never gets a row of its own.
    const tree = buildFileTree([file('a/x.ts'), file('a/b/c.ts')])

    // Rows sort by their label, so the compacted chain sits where its first segment does.
    expect(shape(tree)).toEqual(['dir:a', '  file:b/c.ts', '  file:x.ts'])
  })

  it('draws a whole single-child chain as one file row', () => {
    const tree = buildFileTree([file('a/b/c.ts')])

    expect(shape(tree)).toEqual(['file:a/b/c.ts'])
  })

  it('stops collapsing where a directory has more than one child', () => {
    const tree = buildFileTree([file('a/b/c.ts'), file('a/b/d.ts')])

    expect(shape(tree)).toEqual(['dir:a/b', '  file:c.ts', '  file:d.ts'])
  })

  it('keeps a directory that holds a file and a directory', () => {
    const tree = buildFileTree([file('src/main.ts'), file('src/lib/util.ts')])

    // lib holds nothing but util.ts, so it joins its file's row instead of taking one of its own.
    expect(shape(tree)).toEqual(['dir:src', '  file:lib/util.ts', '  file:main.ts'])
  })

  it('sorts directories before files, each by name', () => {
    // m keeps a directory row only because it holds two files; one would have joined its row.
    const tree = buildFileTree([file('z.ts'), file('a.ts'), file('m/x.ts'), file('m/y.ts')])

    expect(shape(tree)).toEqual(['dir:m', '  file:x.ts', '  file:y.ts', 'file:a.ts', 'file:z.ts'])
  })

  it('reads an empty list as an empty tree', () => {
    expect(buildFileTree([])).toEqual([])
  })
})
