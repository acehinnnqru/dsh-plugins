import { readFile } from 'node:fs/promises'
import { createContext, runInNewContext } from 'node:vm'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The browser half's own side of the artifact contract.
 *
 * The preset has its own conformance tests for the *format* of `lib/client.js`. What is asserted here
 * is this package's side of it: that the built file registers under this package's name, that the
 * Cordis metadata the loader reads is what the source declares, that nothing is required outside the
 * module table, and that the source map still points back at the TypeScript.
 *
 * The built file is executed, not imported, and not simulated: the assertions run against the same
 * bytes the Web GUI downloads. Running it needs no React, because nothing here renders the clock —
 * that is `format.spec.ts`'s job, through the pure formatter the component calls.
 */

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolvePath(here, '..', 'lib', 'client.js')
const PACKAGE_NAME = 'dsh-plugin-now'

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
const BASELINE = ['react', 'react/jsx-runtime'] as const

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
  // The banner is `window.__ModuleLoader__.load(...)`, and the loader is the shell's: the global has
  // to exist before the script runs, exactly as it does in the document the Web GUI serves.
  const context = createContext({
    window: { __ModuleLoader__: { load: (registration: Registration) => captured.push(registration) } },
    // `define` substitutes both of these at build time; a bundle that still reads one at factory time
    // is a bundle that would throw in the browser, so leaving them undefined is deliberate.
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
    // The whole point of the module table: an undeclared row fails here, not in a user's browser.
    throw new Error(`${PACKAGE_NAME} required ${specifier}, which the baseline cannot answer`)
  })
  return { plugin, requested, unanswered }
}

/** One `ctx.slots.register` call, as the stub registry saw it. */
interface Registered {
  options: Record<string, unknown>
  component: unknown
}

/** A slot registry that records what the plugin registers, without a renderer or React. */
function stubCtx(seen: Registered[], wait: string[]): unknown {
  return {
    slots: {
      inject(key: string, callback: () => void) {
        wait.push(key)
        callback()
      },
      register(options: Record<string, unknown>, component: unknown) {
        seen.push({ options, component })
        return () => undefined
      },
    },
  }
}

describe('now browser half', () => {
  it('registers under the package name, not a /client variant', async () => {
    const [registration] = await registrations()
    expect(registration?.id).toBe(PACKAGE_NAME)
  })

  it('exports the loader metadata, and requires nothing outside the baseline', async () => {
    const [registration] = await registrations()
    if (registration === undefined) throw new Error('no registration')
    const { plugin, requested, unanswered } = instantiate(registration)

    expect(unanswered).toEqual([])
    // React is a baseline row: it stays a `require()` of the module table rather than being inlined.
    expect(requested.sort()).toEqual([...BASELINE].sort())
    expect(plugin?.apply).toBeTypeOf('function')
    // The source's `inject` is the Cordis service list; `dsh.client.inject` in the manifest is not this.
    expect(plugin?.inject).toEqual(['slots'])
  })

  it('contributes one cell to the sidebar footer', async () => {
    const [registration] = await registrations()
    if (registration === undefined) throw new Error('no registration')
    const { plugin } = instantiate(registration)

    const seen: Registered[] = []
    const wait: string[] = []
    plugin?.apply?.(stubCtx(seen, wait))

    // `inject` waits for the footer's declaration; the callback is what registers into it.
    expect(wait).toEqual(['sidebar.footer.action'])
    expect(seen).toHaveLength(1)
    expect(seen[0]?.options).toMatchObject({ name: 'sidebar.footer.action', id: 'now-clock' })
    expect(seen[0]?.component).toBeTypeOf('function')
  })

  it('carries its stylesheet inside the bundle', async () => {
    const code = await bundleCode()
    // The preset compiles CSS into the bundle; a missing stylesheet would leave the clock unstyled.
    expect(code).toContain('data-plugin-css')
    expect(code).toContain(`${PACKAGE_NAME}/NowClock.module.css`)
  })

  it('maps the bundle back to the original TypeScript, with its content', async () => {
    const map = JSON.parse(await readFile(join(bundlePath, '..', 'client.js.map'), 'utf8')) as {
      sources?: string[]
      sourcesContent?: string[]
    }
    expect(map.sources?.some((source) => source.includes('client/index.tsx'))).toBe(true)
    expect(map.sourcesContent?.some((content) => content.includes('sidebar.footer.action'))).toBe(true)
  })
})
