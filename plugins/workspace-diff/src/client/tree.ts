/**
 * The changed files as a tree, with the boring middle collapsed.
 *
 * A directory that holds nothing but one child is not worth a row: its name joins its child's, so
 * `a` → `b` → `c.ts` draws as one file row labelled `a/b/c.ts`, and `a/x.ts` beside `a/b/c.ts`
 * draws as directory `a` holding `x.ts` and `b/c.ts`. That is the same compaction the shipped file
 * trees use, and it keeps the tree proportional to the files that actually changed.
 *
 * Pure: the input is the flat list the changes route returned, the output is what the tree renders.
 * @module dsh-plugin-workspace-diff/client/tree
 */

import type { ChangedFileView } from './api.ts'

/** One changed file, labelled by its compacted path relative to its nearest drawn ancestor. */
export interface TreeFileNode {
  readonly kind: 'file'
  /** The row's label, which is the file name or the collapsed directory chain plus it. */
  readonly name: string
  /** The repository-relative path, which is what the diff route accepts. */
  readonly path: string
  /** The route's own record, for the status letter and the counts. */
  readonly file: ChangedFileView
}

/** One directory with something below it. */
export interface TreeDirectoryNode {
  readonly kind: 'directory'
  /** The row's label, with every single-child directory collapsed into it. */
  readonly name: string
  /** The deepest collapsed directory's path, used as this node's identity. */
  readonly path: string
  readonly children: readonly TreeNode[]
}

/** One drawn row. */
export type TreeNode = TreeFileNode | TreeDirectoryNode

/** A directory while the input list is still being folded into a tree. */
interface RawDirectory {
  readonly name: string
  readonly path: string
  readonly directories: Map<string, RawDirectory>
  readonly files: TreeFileNode[]
}

/**
 * Build the tree the view draws.
 * @param files - the changes route's file list, in any order.
 * @returns the root's children: directories first, then files, each sorted by name.
 */
export function buildFileTree(files: readonly ChangedFileView[]): TreeNode[] {
  const root: RawDirectory = { name: '', path: '', directories: new Map(), files: [] }

  for (const file of files) {
    const segments = file.path.split('/')
    const name = segments.pop() ?? file.path
    let directory = root
    for (const segment of segments) {
      if (segment === '') continue
      let next = directory.directories.get(segment)
      if (next === undefined) {
        next = {
          name: segment,
          path: directory.path === '' ? segment : directory.path + '/' + segment,
          directories: new Map(),
          files: [],
        }
        directory.directories.set(segment, next)
      }
      directory = next
    }
    directory.files.push({ kind: 'file', name, path: file.path, file })
  }

  return render(root)
}

/**
 * Collapse one directory's single-child chain, then render what is left.
 * @param directory - the directory to draw.
 * @returns the drawn nodes, sorted.
 */
function render(directory: RawDirectory): TreeNode[] {
  const directories = [...directory.directories.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(collapse)
  const files = [...directory.files].sort((left, right) => left.name.localeCompare(right.name))
  return [...directories, ...files]
}

/**
 * Turn one directory into the single row (or file row) it deserves.
 * @param directory - the directory to collapse.
 * @returns the drawn node.
 */
function collapse(directory: RawDirectory): TreeNode {
  let name = directory.name
  let current = directory

  // Keep folding while the level holds exactly one directory and no files of its own.
  while (current.files.length === 0 && current.directories.size === 1) {
    const only = [...current.directories.values()][0]
    if (only === undefined) break
    name = name + '/' + only.name
    current = only
  }

  // A chain that ends in a single file is that file's row, labelled with the chain.
  const [only, ...rest] = current.files
  if (only !== undefined && rest.length === 0 && current.directories.size === 0) {
    return { kind: 'file', name: name + '/' + only.name, path: only.path, file: only.file }
  }

  return { kind: 'directory', name, path: current.path, children: render(current) }
}
