/**
 * The changed files as a tree, collapsed the way the tree module compacts it: a directory row opens
 * and closes, a file row opens that file's diff in the right Sidebar.
 * @module dsh-plugin-workspace-diff/client/FileTree
 */

import { useState, type ReactNode } from 'react'
import type { TreeNode } from './tree.ts'
import type { WorkspaceDiffKey } from './locales.ts'
import { countLabel } from './messages.ts'
import css from './WorkspaceDiffView.module.css'

/** What the tree draws and what it does when a file is picked. */
export interface FileTreeProps {
  /** The root's children, from `buildFileTree`. */
  readonly nodes: readonly TreeNode[]
  /** Open one repository-relative path's diff. */
  readonly onOpen: (path: string) => void
  /** Translate one key of this view's namespace. */
  readonly t: (key: WorkspaceDiffKey) => string
}

/**
 * Render the file tree.
 * @param props - the nodes, the opener, and the translate function.
 * @returns the tree.
 */
export function FileTree({ nodes, onOpen, t }: FileTreeProps): ReactNode {
  // Collapsed rather than expanded, so a directory added between renders starts open.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())

  const toggle = (path: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const renderNodes = (list: readonly TreeNode[]): ReactNode => list.map((node) => {
    if (node.kind === 'file') {
      return (
        <li key={node.path}>
          <button type="button" className={css.treeFile} title={node.path} onClick={() => { onOpen(node.path) }}>
            <span className={css.status}>{node.file.status}</span>
            <span className={css.path}>{node.name}</span>
            <span className={css.counts}>
              <span className={css.added}>{'+' + countLabel(node.file.added)}</span>
              <span className={css.deleted}>{'-' + countLabel(node.file.removed)}</span>
            </span>
          </button>
        </li>
      )
    }
    const closed = collapsed.has(node.path)
    return (
      <li key={node.path}>
        <button
          type="button"
          className={css.treeDirectory}
          aria-expanded={!closed}
          aria-label={t(closed ? 'tree.expand' : 'tree.collapse')}
          onClick={() => { toggle(node.path) }}
        >
          <span className={css.chevron}>{closed ? '▸' : '▾'}</span>
          <span className={css.path}>{node.name}</span>
        </button>
        {closed ? null : <ul className={css.treeChildren}>{renderNodes(node.children)}</ul>}
      </li>
    )
  })

  return <ul className={css.tree}>{renderNodes(nodes)}</ul>
}
