/**
 * The sidebar-footer clock: a live readout of the browser's own time.
 *
 * It is the repo's first browser-half component, and deliberately the smallest one that is still
 * worth reading: no host data, no services beyond `slots`, no cross-plugin imports. Anything the
 * clock needs it computes, so the only thing this half shares with the rest of the product is the
 * slot API.
 *
 * The `.tsx` extension is what lets tsc accept the JSX at all, and it is also what keeps the entry
 * on the path the preset builds: `src/client/index.tsx` emits `lib/types/client/index.js`, which is
 * the preset's default browser entry. A `src/client/index.ts` holding JSX does not compile.
 *
 * @module dsh-plugin-now/client
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: it carries the declaration merge that puts `sidebar.footer.action` into `SlotMap` and
// `ctx.slots` onto `Context`. It never reaches the bundle — the purity gate would refuse it if it did.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { clockLabel, timestamp } from './format.ts'
import css from './NowClock.module.css'

/** How often the readout redraws. One second is the smallest step the label can show. */
const TICK_MS = 1_000

/** The list cell this half occupies; the id is also what distinguishes it in the sidebar footer. */
const SLOT = 'sidebar.footer.action'
const ID = 'now-clock'

/** Cordis service names this plugin waits for — the slot registry, and nothing else. */
export const inject = ['slots']

/** The sidebar footer hands its occupant only the column state. */
type ClockProps = PropsRuntime<typeof SLOT>

/**
 * Render one clock reading, re-rendering on every tick.
 *
 * The timer is started once and never restarted: the label is derived from the instant at render
 * time, so a re-render does not need the interval to change identity.
 * @param props - the sidebar footer's owner props.
 * @returns the clock button.
 */
function NowClock({ wide }: ClockProps): ReactNode {
  const [at, setAt] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => {
      setAt(new Date())
    }, TICK_MS)
    return () => {
      clearInterval(timer)
    }
  }, [])

  const label = clockLabel(at, wide)
  return (
    <button
      type="button"
      className={css.clock}
      title={`Copy the current time — ${timestamp(at)}`}
      onClick={() => {
        void navigator.clipboard?.writeText(timestamp(at))
      }}
    >
      {label}
    </button>
  )
}

/**
 * Contribute the clock to the sidebar footer.
 * @param ctx - client context carrying the slot registry.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject(SLOT, () => ctx.slots.register({
    name: SLOT,
    id: ID,
    // After the shipped footer entries: this is an addition to the foot, not a replacement for it.
    order: 100,
  }, NowClock))
}
