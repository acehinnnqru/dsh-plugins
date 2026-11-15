/**
 * The sidebar's glyph for the session board.
 *
 * Two session cards, the older one emerging from behind the newer: a pile of Sessions is what the
 * panel manages, and the stack is the one shape that says "several" at 16px. The stock checklist
 * glyph this replaced named a to-do list, and the three-column board tried before it read as a bar
 * chart rather than as several Sessions.
 *
 * Drawn here rather than taken from the primitive set, which has no card or board glyph. The
 * geometry follows the set's own outline convention — a 24-unit box, 1.5-unit stroke, round joins,
 * stroke-only, inheriting `currentColor` — so it sits at the same optical weight as its neighbours.
 *
 * Both cards share one corner radius, and the card behind stops a gap short of the one in front.
 * Meeting the front card's stroke head-on would turn the back card's edge into a square T-junction,
 * which reads as a box rather than as a second card. A stroke-only icon has no fill to occlude with,
 * so the gap is what shows the depth.
 * @module dsh-plugin-session-manager/client/icon
 */

import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** The global panel row hands its occupant the requested size and selection state. */
type IconProps = PropsRuntime<'sidebar.panellist'>

/**
 * Render the stacked-cards glyph at the size the sidebar asks for.
 * @param props - requested edge and whether this panel is selected.
 * @returns the icon element.
 */
export function SessionManagerIcon({ size }: IconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15.5 7.7V7A2.5 2.5 0 0 0 13 4.5H7A2.5 2.5 0 0 0 4.5 7V13A2.5 2.5 0 0 0 7 15.5H7.7" />
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    </svg>
  )
}
