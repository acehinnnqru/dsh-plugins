/**
 * `dsh-plugin-session-manager`, host half.
 *
 * The board is browser-only: it reads the live Session list and the unified UI status the Web client
 * already owns, then opens a Session through the Workspace navigation service. The host half exists
 * because the browser module graph is built from live Loader rows — an empty `apply` is what puts
 * this package's `./client` export into that graph.
 * @module dsh-plugin-session-manager
 */

/** Loader metadata: the name shown in fiber diagnostics and logs. */
export const name = 'session-manager'

/** Host plugin body: a pure UI package contributes nothing to the host tree. */
export function apply(): void {}
