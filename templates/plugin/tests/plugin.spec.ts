import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/index.ts'

/** The definition shape this plugin registers, read off the registry it registers on. */
type ToolDefinition = Parameters<Context['tools']['register']>[0]

/**
 * Run `apply` against a stub ctx and return the definition it handed to the registry.
 * @returns the definition handed to `ctx.tools.register`.
 */
function load(): ToolDefinition {
  const registered: ToolDefinition[] = []
  const ctx = {
    tools: {
      register(definition: ToolDefinition) {
        registered.push(definition)
        return () => undefined
      },
    },
  } as unknown as Context

  apply(ctx)

  const [tool] = registered
  if (!tool) throw new Error('apply registered no tool')
  return tool
}

describe('__NAME__ plugin', () => {
  it('declares the loader metadata the loader reads', () => {
    expect(name).toBe('__NAME__')
    expect(inject).toEqual(['tools'])
  })

  it('registers exactly one tool, named __NAME__', () => {
    expect(load().name).toBe('__NAME__')
  })

  it('echoes the text argument', async () => {
    const tool = load()
    await expect(tool.execute({ text: 'hi' }, undefined as never)).resolves.toBe('hi')
  })
})
