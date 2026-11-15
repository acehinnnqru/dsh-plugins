/**
 * The node badge shared by board cards and management rows.
 *
 * One component keeps the two lists from drifting: the chip names the owning node, marks this host
 * in the business color, and keeps the installation hash in its tooltip where a card has one.
 * @module dsh-plugin-session-manager/client/node-badge
 */

import type { ReactNode } from 'react'
import type { SessionNode } from './board.ts'
import css from './SessionBoard.module.css'

/** Props of the node badge. */
export interface NodeBadgeProps {
  /** Owning node of the Session the badge sits on. */
  readonly node: SessionNode
  /** Extra class for a surface that needs different geometry. */
  readonly className?: string
}

/**
 * Render one node badge.
 * @param props - the owning node and an optional surface class.
 * @returns the chip.
 */
export function NodeBadge({ node, className }: NodeBadgeProps): ReactNode {
  const label = node.self ? 'self' : node.name
  const title = node.self || node.instanceId === undefined
    ? label
    : label + ' · ' + node.instanceId
  const base = css.cardNode ?? ''
  return (
    <span
      className={className === undefined ? base : base + ' ' + className}
      data-self={node.self ? 'true' : undefined}
      title={title}
    >
      {label}
    </span>
  )
}
