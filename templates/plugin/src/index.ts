/**
 * `__PACKAGE__`, host half.
 *
 * The named exports are loader metadata: `name` is what diagnostics show, `inject` delays `apply`
 * until `ctx.tools` exists. Register everything through `ctx` so it is disposed again when the
 * plugin unloads.
 * @module __PACKAGE__
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Loader metadata: the name shown in fiber diagnostics and logs. */
export const name = '__NAME__'

/** Loader metadata: this plugin's `apply` runs only once `ctx.tools` exists. */
export const inject = ['tools']

/**
 * Register the `__NAME__` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: '__NAME__',
    description: 'TODO: say what this tool does and when to use it — the model picks tools by description.',
    parameters: {
      text: {
        type: 'string',
        description: 'TODO: describe this parameter.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    // Every tool body is async, even a synchronous one: the registry awaits the returned promise,
    // and `defineTool` types it as one.
    async execute(args) {
      return args.text ?? ''
    },
  }))
}
