/**
 * `__PACKAGE__`, browser half.
 *
 * The `.tsx` extension is not style: tsc rejects JSX in a `.ts` file, and `src/client/index.tsx` is
 * also the path that emits `lib/types/client/index.js`, the preset's default browser entry.
 *
 * Only import values from DSH baseline modules. The bundle build refuses cross-plugin value imports
 * on purpose; type-only imports for declaration merges are fine and never reach the bundle.
 * @module __PACKAGE__/client
 */

import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: they carry the declaration merges that put `sidebar.footer.action` into `SlotMap` and
// `ctx.slots` onto `Context`.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** The slot this half occupies; the catalog is in the DSH checkout's docs/subsystems/slots.md. */
const SLOT = 'sidebar.footer.action'

/** Distinguishes this entry from the shipped ones inside the same slot. */
const ID = '__NAME__'

/** Cordis service names this plugin waits for. */
export const inject = ['slots']

/** The sidebar footer hands its occupant only the column state. */
type EntryProps = PropsRuntime<typeof SLOT>

/**
 * TODO: replace this with the real UI.
 * @param _props - the slot's owner props.
 * @returns the rendered entry.
 */
function Entry(_props: EntryProps): ReactNode {
  return <span>__NAME__</span>
}

/**
 * Contribute the entry to the sidebar footer.
 * @param ctx - client context carrying the slot registry.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject(SLOT, () => ctx.slots.register({
    name: SLOT,
    id: ID,
    order: 100,
  }, Entry))
}
