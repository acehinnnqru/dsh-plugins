/**
 * The sidebar's glyph for the session board.
 *
 * The sidebar owns the panel button, its label, and its selected state; this component is only the
 * leading icon the `sidebar.panellist` list renders.
 * @module dsh-plugin-session-manager/client/icon
 */

import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChecklistOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/** The global panel row hands its occupant the requested size and selection state. */
type IconProps = PropsRuntime<'sidebar.panellist'>

/**
 * Render the board glyph at the size the sidebar asks for.
 * @param props - requested edge and whether this panel is selected.
 * @returns the icon element.
 */
export function SessionManagerIcon({ size }: IconProps): ReactNode {
  return <IconChecklistOutlineRegular size={size} />
}
