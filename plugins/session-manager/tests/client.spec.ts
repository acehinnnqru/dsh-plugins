import { readFile } from 'node:fs/promises'
import { createContext, runInNewContext } from 'node:vm'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The browser half's side of the artifact contract.
 *
 * The preset has its own conformance tests for the *format* of `lib/client.js`. What is asserted here
 * is this package's side of it: that the built file registers under this package's name, exports the
 * Cordis metadata the loader reads, asks only for baseline modules, and contributes the page and the
 * sidebar row under one id.
 *
 * The built file is executed, not imported, and not simulated: the assertions run against the same
 * bytes the Web GUI downloads.
 */

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolvePath(here, '..', 'lib', 'client.js')
const PACKAGE_NAME = 'dsh-plugin-session-manager'

/** The Cordis plugin object a bundle's factory returns. */
interface Plugin {
  apply?: (ctx: unknown) => void
  inject?: unknown
}

/** What the shell hands the bundle: `window.__ModuleLoader__.load({ id, factory })`. */
interface Registration {
  id?: unknown
  factory?: (require: (specifier: string) => unknown) => Plugin
}

/** The module table the shell freezes before any plugin bundle runs. */
const BASELINE = ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'] as const

/** Read the built bundle, naming the fix when the build has not run yet. */
async function bundleCode(): Promise<string> {
  try {
    return await readFile(bundlePath, 'utf8')
  } catch {
    throw new Error(`${bundlePath} is missing — run \`pnpm --filter ${PACKAGE_NAME} build\` first`)
  }
}

/**
 * Execute the built bundle in a plain V8 context with a fake `__ModuleLoader__`, exactly as a
 * classic `<script>` does in the browser: the file itself is the program, and everything it registers
 * is what the loader would have received.
 * @returns every registration the bundle made.
 */
async function registrations(): Promise<Registration[]> {
  const captured: Registration[] = []
  const context = createContext({
    window: { __ModuleLoader__: { load: (registration: Registration) => captured.push(registration) } },
  })
  runInNewContext(await bundleCode(), context)
  expect(captured).toHaveLength(1)
  return captured
}

/**
 * Run one registration's factory against a module table.
 * @param registration - the registration to instantiate.
 * @returns the plugin object, the specifiers it asked for, and whether the table answered them all.
 */
function instantiate(registration: Registration): {
  plugin: Plugin | undefined
  requested: string[]
  unanswered: string[]
} {
  const requested: string[] = []
  const unanswered: string[] = []
  const plugin = registration.factory?.((specifier: string) => {
    requested.push(specifier)
    if ((BASELINE as readonly string[]).includes(specifier)) return {}
    unanswered.push(specifier)
    throw new Error(`${PACKAGE_NAME} required ${specifier}, which the baseline cannot answer`)
  })
  return { plugin, requested, unanswered }
}

/** One `ctx.slots.register` call, as the stub registry saw it. */
interface Registered {
  options: Record<string, unknown>
  component: unknown
}

/** A Cordis context that records what the plugin registers, without a renderer or React. */
function stubCtx(seen: Registered[], wait: string[]): unknown {
  return {
    effect(callback: () => unknown) {
      const disposal = callback()
      return typeof disposal === 'function' ? disposal as () => void : () => undefined
    },
    locale: {
      register() {
        return () => undefined
      },
      bind() {
        return (key: string) => key
      },
    },
    slots: {
      inject(key: string, callback: () => void) {
        wait.push(key)
        callback()
        return () => undefined
      },
      register(options: Record<string, unknown>, component: unknown) {
        seen.push({ options, component })
        return () => undefined
      },
    },
    sessions: {
      retain() {
        return { release() {} }
      },
    },
  }
}

describe('session-manager browser half', () => {
  it('registers under the package name, not a /client variant', async () => {
    const [registration] = await registrations()
    expect(registration?.id).toBe(PACKAGE_NAME)
  })

  it('exports the loader metadata, and requires nothing outside the baseline', async () => {
    const [registration] = await registrations()
    if (registration === undefined) throw new Error('no registration')
    const { plugin, requested, unanswered } = instantiate(registration)

    expect(unanswered).toEqual([])
    expect(requested.sort()).toEqual([...BASELINE].sort())
    expect(plugin?.apply).toBeTypeOf('function')
    // The source's `inject` is the Cordis service list; `dsh.client.inject` in the manifest is not this.
    expect(plugin?.inject).toEqual(['slots', 'locale', 'sessions', 'uiSession'])
  })

  it('contributes a main page, its preview child, and one sidebar row', async () => {
    const [registration] = await registrations()
    if (registration === undefined) throw new Error('no registration')
    const { plugin } = instantiate(registration)

    const seen: Registered[] = []
    const wait: string[] = []
    plugin?.apply?.(stubCtx(seen, wait))

    // The page's main declaration owns the child slot; the host waits for that declaration.
    expect(wait).toEqual(['main', 'session-manager.conversation', 'sidebar.panellist'])
    expect(seen).toHaveLength(3)
    expect(seen[0]?.options).toMatchObject({
      name: 'main',
      key: 'session-manager',
      children: {
        'session-manager.conversation': { kind: 'single', scope: 'session' },
      },
    })
    expect(seen[1]?.options).toMatchObject({
      name: 'session-manager.conversation',
      locale: 'sessionManager',
    })
    expect(seen[2]?.options).toMatchObject({
      name: 'sidebar.panellist',
      id: 'session-manager',
      order: 30,
    })

    const label = seen[2]?.options['label']
    expect(label).toBeTypeOf('function')
    expect((label as () => string)()).toBe('panel.title')
    expect(seen[0]?.component).toBeTypeOf('function')
    expect(seen[1]?.component).toBeTypeOf('function')
    expect(seen[2]?.component).toBeTypeOf('function')
  })

  it('carries its stylesheet inside the bundle', async () => {
    const code = await bundleCode()
    expect(code).toContain('data-plugin-css')
    expect(code).toContain(`${PACKAGE_NAME}/SessionBoard.module.css`)
  })

  it('maps the bundle back to the board source', async () => {
    const map = JSON.parse(await readFile(join(bundlePath, '..', 'client.js.map'), 'utf8')) as {
      sources?: string[]
      sourcesContent?: string[]
    }
    expect(map.sources?.some((source) => source.includes('client/index.tsx'))).toBe(true)
    expect(map.sources?.some((source) => source.includes('client/board.ts'))).toBe(true)
    expect(map.sources?.some((source) => source.includes('client/ConversationHost.tsx'))).toBe(true)
    expect(map.sourcesContent?.some((content) => content.includes('sidebar.panellist'))).toBe(true)
    expect(map.sourcesContent?.some((content) => content.includes('completionUnread'))).toBe(true)
    expect(map.sourcesContent?.some((content) => content.includes('conversation.content'))).toBe(true)
  })
})
