import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { Config, apply, inject, name } from '../src/index.ts'

/** The definition shape this plugin registers, read off the registry it registers on. */
type ToolDefinition = Parameters<Context['tools']['register']>[0]

/**
 * Validate a raw config the way the loader does, then run `apply` against a stub ctx.
 * @param input - the raw config object a profile row would carry.
 * @returns the definition handed to `ctx.tools.register`.
 */
function load(input: unknown = {}): ToolDefinition {
  const validated = Config['~standard'].validate(input) as { value?: Config }
  if (!validated.value) throw new Error(`config did not validate: ${JSON.stringify(input)}`)

  const registered: ToolDefinition[] = []
  const ctx = {
    logger: { info: () => undefined },
    tools: {
      register(definition: ToolDefinition) {
        registered.push(definition)
        return () => undefined
      },
    },
  } as unknown as Context

  apply(ctx, validated.value)

  const [tool] = registered
  if (!tool) throw new Error('apply registered no tool')
  return tool
}

/** Call one tool execution without a real run context; this tool reads nothing from it. */
function call(tool: ToolDefinition, args: Record<string, unknown>): Promise<unknown> {
  return tool.execute(args, undefined as never)
}

describe('now plugin', () => {
  it('declares the loader metadata the loader reads', () => {
    expect(name).toBe('now')
    expect(inject).toEqual(['tools'])
  })

  it('registers exactly one tool, named now', () => {
    expect(load().name).toBe('now')
  })

  it('answers an ISO-8601 UTC timestamp when format is omitted', async () => {
    const value = await call(load(), {})
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('renders the configured time zone for format: human', async () => {
    const tool = load({ timeZone: 'Asia/Shanghai' })
    const before = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Shanghai' })
    const value = await call(tool, { format: 'human' })
    const after = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Shanghai' })
    expect([before, after]).toContain(value)
  })

  it('defaults timeZone to UTC', async () => {
    expect(Config['~standard'].validate({})).toMatchObject({ value: { timeZone: 'UTC' } })

    const tool = load()
    const before = new Date().toLocaleString('en-GB', { timeZone: 'UTC' })
    const value = await call(tool, { format: 'human' })
    const after = new Date().toLocaleString('en-GB', { timeZone: 'UTC' })
    expect([before, after]).toContain(value)
  })
})
