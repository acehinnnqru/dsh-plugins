/**
 * Browser half of the fixture.
 *
 * It exercises the three things the preset has to get right: a baseline import survives the build as
 * a `require()` the factory can satisfy, both style-injecting CSS forms land in `<head>` with the
 * host's tags, and `?inline` hands back text without injecting anything.
 */

import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import classes from './greeting.module.css'
import './global.css'
import inlineText from './inline.css?inline'

/** Cordis service names this plugin waits for; the fixture needs none. */
export const inject: string[] = []

/** What the last {@link apply} observed, read by the conformance test. */
export interface HelloObservations {
  /** Whether the baseline `require()` delivered the module table's `SlotCore`. */
  baselineResolved: boolean
  /** The CSS Modules local-to-hashed map. */
  classMap: Record<string, string>
  /** The `?inline` stylesheet text. */
  inlineText: string
}

/**
 * Record that the host called this plugin, and expose what the bundle resolved.
 * @param _ctx - the client context; unused here.
 */
export function apply(_ctx: unknown): void {
  const globals = globalThis as typeof globalThis & {
    __helloApplied?: boolean
    __helloObservations?: HelloObservations
  }
  globals.__helloApplied = true
  globals.__helloObservations = {
    baselineResolved: typeof SlotCore === 'function',
    classMap: classes,
    inlineText,
  }
}
