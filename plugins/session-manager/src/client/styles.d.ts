/**
 * Ambient declaration for the CSS modules the client bundle imports.
 *
 * The preset compiles each `*.module.css` into a hashed class map plus a tagged style element, so the
 * default export is the map and nothing else is needed at the call site.
 * @module dsh-plugin-session-manager/client/styles
 */

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
