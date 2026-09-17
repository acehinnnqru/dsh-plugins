/**
 * A minimal host-half plugin: it registers one `now` tool that answers with the current time.
 *
 * It is the repo's reference plugin — the shape to copy when adding a real one: named exports carry
 * the loader metadata, `Config` is a Schemastery schema so the profile can configure it, and every
 * registration goes through `ctx` so it is disposed again when the plugin unloads.
 * @module dsh-plugin-now
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/** Loader metadata: the name shown in fiber diagnostics and logs. */
export const name = 'now'

/** Loader metadata: this plugin's `apply` runs only once `ctx.tools` exists. */
export const inject = ['tools']

/** Deployment configuration, overridden through the profile's patch layer. */
export interface Config {
  /** IANA time zone name used by `format: 'human'`, for example `Asia/Shanghai`. */
  timeZone: string
}

/** Schemastery schema for {@link Config}; the default is what an unconfigured profile gets. */
export const Config: z<Config> = z.object({
  timeZone: z.string().default('UTC'),
})

/**
 * Register the `now` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - resolved deployment configuration.
 */
export function apply(ctx: Context, config: Config): void {
  // Diagnostics, not startup output: cordis always accepts `ctx.logger` messages, but they only fill
  // a ring buffer unless the deployment mounts an exporter — and no shipped DSH profile mounts one.
  // Treat this as the idiomatic channel to log through, not as a line a terminal will show.
  ctx.logger.info('now: registering the now tool (timeZone=%s)', config.timeZone)

  ctx.tools.register(defineTool({
    name: 'now',
    description:
      'Return the current time. Use it whenever the user asks for the time or the date, instead of '
      + 'guessing: the answer comes from the host clock. Defaults to an ISO-8601 UTC timestamp; '
      + `format "human" renders the deployment's configured time zone (${config.timeZone}).`,
    parameters: {
      format: {
        type: 'string',
        enum: ['iso', 'human'],
        description: 'iso (default) returns an ISO-8601 UTC timestamp; human renders the configured time zone.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    // Every tool body is async, even one that computes its answer synchronously: the registry
    // awaits the returned promise, and `defineTool` types it as one.
    async execute(args) {
      const at = new Date()
      if (args.format === 'human') {
        return at.toLocaleString('en-GB', { timeZone: config.timeZone })
      }
      return at.toISOString()
    },
  }))
}
