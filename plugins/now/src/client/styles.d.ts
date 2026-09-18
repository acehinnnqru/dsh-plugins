/**
 * Ambient declarations for the stylesheet import forms the client preset compiles.
 *
 * Upstream keeps the same three declarations in `packages/client/ui-theme/src/css-modules.d.ts`, but
 * that file is inside a package's `src/` and is not part of any published type graph, so an
 * out-of-tree plugin has to carry its own copy. The shapes are the preset's `cssPlugins` contract:
 * `.module.css` exports a class map, `?inline` exports text, and a plain `.css` is imported for its
 * side effect.
 */

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css'

declare module '*.css?inline' {
  const css: string
  export default css
}
