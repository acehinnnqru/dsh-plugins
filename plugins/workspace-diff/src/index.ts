/**
 * dsh-plugin-workspace-diff, host half.
 *
 * The host half reads the Session workspace through the profile's own shell executor and answers two
 * authenticated routes over Connection's fetch registry; the browser half renders them. The named
 * exports are loader metadata: name is what diagnostics show, inject delays apply until the services
 * the routes need exist.
 * @module dsh-plugin-workspace-diff
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerWorkspaceDiffRoutes } from './routes.ts'

/** Loader metadata: the name shown in fiber diagnostics and logs. */
export const name = 'workspace-diff'

/**
 * Loader metadata: the routes need the executor, the Connection registry, Session lookup, the live
 * Session store (for the sandbox policy), and the policy service itself.
 */
export const inject = ['shell', 'connection', 'sessionQuery', 'sessions', 'sandboxPolicy']

/**
 * Register the two routes for this plugin's lifetime.
 * @param ctx - host context carrying every injected service.
 */
export function apply(ctx: Context): void {
  registerWorkspaceDiffRoutes(ctx)
}
