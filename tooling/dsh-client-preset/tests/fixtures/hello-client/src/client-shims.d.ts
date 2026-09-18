/**
 * Declarations for baseline specifiers whose types only exist in the DSH checkout.
 *
 * Nothing resolves these from disk at runtime — the host shell's frozen module table answers the
 * `require()` — so the type checker gets the shape here and the conformance test supplies the value.
 */

declare module '@deepseek-ai/dsh-client-ui-slots' {
  /** A slot registry, as the module table hands it to a plugin. */
  export class SlotCore {
    /** Not part of the fixture's contract; only proves the value arrived. */
    readonly __slotCoreBrand?: never
  }
}

declare module '@deepseek-ai/dsh-client-web/src/platform.ts' {
  export const PLATFORM_MODULES: readonly string[]
}
