import { readFile } from 'node:fs/promises'
import { createContext, runInNewContext } from 'node:vm'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The browser half's own side of the artifact contract.
 *
 * The preset has its own conformance tests for the *format* of lib/client.js. What is asserted here
 * is this package's side of it: that the built file registers under this package's name, that the
 * metadata the loader reads is what the source declares, that nothing is required outside the module
 * table, and that both surfaces register where they should. The built file is executed, not
 * imported, and not simulated.
 */

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolvePath(here, '..', 'lib', 'client.js')
const PACKAGE_NAME = 'dsh-plugin-workspace-diff'
const TAB_ID = 'dsh-plugin-workspace-diff'

/** The Cordis plugin object a bundle's factory returns. */
interface Plugin {
  apply?: (ctx: unknown) => void
  inject?: unknown
}

/** What the shell hands the bundle: window.__ModuleLoader__.load({ id, factory }). */
interface Registration {
  id?: unknown
  factory?: (require: (specifier: string) => unknown) => Plugin
}

/**
 * The module table the shell freezes before any plugin bundle runs. The primitives are a baseline
 * row: this bundle value-imports the wrap icon and its tooltip from there, and everything else
 * cross-package in the source is type-only.
 */
const BASELINE = ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'] as const

/** Read the built bundle, naming the fix when the build has not run yet. */
async function bundleCode(): Promise<string> {
  try {
    return await readFile(bundlePath, 'utf8')
  } catch {
    throw new Error(bundlePath + ' is missing — run pnpm --filter ' + PACKAGE_NAME + ' build first')
  }
}

/**
 * Execute the built bundle in a plain V8 context with a fake __ModuleLoader__, exactly as a classic
 * script does in the browser.
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
 * Instantiate the plugin from its registration.
 * @returns the plugin object, the specifiers it asked for, and the ones the table could not answer.
 */
function instantiate(registration: Registration): { plugin: Plugin | undefined; requested: string[]; unanswered: string[] } {
  const requested: string[] = []
  const unanswered: string[] = []
  const plugin = registration.factory?.((specifier: string) => {
    requested.push(specifier)
    if ((BASELINE as readonly string[]).includes(specifier)) return {}
    unanswered.push(specifier)
    throw new Error(PACKAGE_NAME + ' required ' + specifier)
  })
  return { plugin, requested, unanswered }
}

/** One ctx.slots.register call, as the stub registry saw it. */
interface Registered {
  options: Record<string, unknown>
  component: unknown
}

/** Everything the stub context recorded. */
interface Stub {
  ctx: unknown
  registered: Registered[]
  waited: string[]
  opened: string[]
  tabTypes: Record<string, unknown>[]
}

/** A client context that records registrations and opens, without a renderer or React. */
function stubCtx(): Stub {
  const registered: Registered[] = []
  const waited: string[] = []
  const opened: string[] = []
  const tabTypes: Record<string, unknown>[] = []
  return {
    registered,
    waited,
    opened,
    tabTypes,
    ctx: {
      effect(callback: () => unknown) {
        callback()
        return () => undefined
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
          waited.push(key)
          callback()
        },
        register(options: Record<string, unknown>, component: unknown) {
          registered.push({ options, component })
          return () => undefined
        },
      },
      sidebarRightTabs: {
        register(definition: Record<string, unknown>) {
          tabTypes.push(definition)
          return () => undefined
        },
      },
      sidebarRight: {
        openResource(address: string) {
          opened.push(address)
        },
      },
      remote: { workspaceFiles: { changes: () => (async function* empty() {})() } },
    },
  }
}

describe('workspace-diff browser half', () => {
  it('registers under the package name, not a /client variant', async () => {
    const [registration] = await registrations()
    expect(registration?.id).toBe(PACKAGE_NAME)
  })

  it('requires nothing outside the baseline and keeps the source inject list', async () => {
    const [registration] = await registrations()
    if (registration === undefined) throw new Error('no registration')
    const { plugin, requested, unanswered } = instantiate(registration)

    expect(unanswered).toEqual([])
    expect(requested.sort()).toEqual([...BASELINE].sort())
    expect(plugin?.apply).toBeTypeOf('function')
    expect(plugin?.inject).toEqual(['slots', 'locale', 'remote', 'remote.workspaceFiles', 'sidebarRight', 'sidebarRightTabs'])
  })

  it('contributes the file tree to conversation.view, after chat and trajectory', async () => {
    const [registration] = await registrations()
    if (registration === undefined) throw new Error('no registration')
    const { plugin } = instantiate(registration)
    const stub = stubCtx()
    plugin?.apply?.(stub.ctx)

    const view = stub.registered.find(entry => entry.options.name === 'conversation.view')
    expect(stub.waited).toContain('conversation.view')
    expect(view?.options).toMatchObject({
      name: 'conversation.view',
      id: 'workspace-diff',
      order: 20,
      locale: 'workspaceDiff',
    })
    expect(view?.component).toBeTypeOf('function')
  })

  it('claims a right-Sidebar tab type and registers its body under that id', async () => {
    const [registration] = await registrations()
    if (registration === undefined) throw new Error('no registration')
    const { plugin } = instantiate(registration)
    const stub = stubCtx()
    plugin?.apply?.(stub.ctx)

    expect(stub.tabTypes).toHaveLength(1)
    expect(stub.tabTypes[0]).toMatchObject({
      id: TAB_ID,
      kind: 'workspace-diff',
      patterns: ['dsh-resource://workspace-diff/**'],
    })
    const body = stub.registered.find(entry => entry.options.name === 'sidebar.right.pane.tab')
    expect(body?.options).toMatchObject({ name: 'sidebar.right.pane.tab', key: TAB_ID, locale: 'workspaceDiff' })
    expect(body?.component).toBeTypeOf('function')
  })

  it('opens one file address in the right Sidebar from the tree', async () => {
    const [registration] = await registrations()
    if (registration === undefined) throw new Error('no registration')
    const { plugin } = instantiate(registration)
    const stub = stubCtx()
    plugin?.apply?.(stub.ctx)

    const view = stub.registered.find(entry => entry.options.name === 'conversation.view')
    const inject = view?.options.inject
    expect(inject).toBeTypeOf('function')
    const injected = (inject as (sessionId: string) => Record<string, unknown>)('session-1')
    expect(injected.api).toBeTypeOf('object')
    expect(injected.t).toBeTypeOf('function')

    ;(injected.openDiff as (path: string) => void)('a/b c.ts')
    expect(stub.opened).toEqual(['dsh-resource://workspace-diff/session/session-1/a%2Fb%20c.ts'])
  })

  it('carries its stylesheet inside the bundle', async () => {
    const code = await bundleCode()
    expect(code).toContain('data-plugin-css')
    expect(code).toContain(PACKAGE_NAME + '/WorkspaceDiffView.module.css')
  })

  it('maps the bundle back to the original TypeScript, with its content', async () => {
    const map = JSON.parse(await readFile(join(bundlePath, '..', 'client.js.map'), 'utf8')) as {
      sources?: string[]
      sourcesContent?: string[]
    }
    expect(map.sources?.some((source) => source.includes('client/index.tsx'))).toBe(true)
    expect(map.sourcesContent?.some((content) => content.includes('conversation.view'))).toBe(true)
  })
})
