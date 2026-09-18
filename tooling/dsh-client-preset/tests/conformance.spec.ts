import { execFile, spawn } from 'node:child_process'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

/**
 * The artifact contract, end to end: build a plugin with the preset, then load what it produced the
 * way the Web GUI loads it — as a plain script in a document whose `window.__ModuleLoader__` records
 * the factory, then run the factory against a module table and see whether the plugin applies.
 *
 * The fixture is built through its own `tsc -b` + `tsdown` pair rather than by calling
 * `clientBundle()` here: a package-level `tsdown.config.ts` is where a plugin actually wires the
 * preset up, so a test that skipped it would not be testing the path a plugin uses.
 */

const run = promisify(execFile)

const presetDir = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
const fixturesDir = join(presetDir, 'tests', 'fixtures')

const HELLO = 'hello-client'
const FORBIDDEN = 'forbidden-import'
const NO_CLIENT_EXPORT = 'no-client-export'

/** A module-table factory, as `window.__ModuleLoader__.load` receives it. */
type Factory = (require: (id: string) => unknown) => { apply?: (ctx: unknown) => void }

/** What the fixture's `apply` records for the test to read. */
interface HelloObservations {
  baselineResolved: boolean
  classMap: Record<string, string>
  inlineText: string
}

/** The stubbed module table the baseline resolves against, and the specifiers it was asked for. */
const SLOTS = '@deepseek-ai/dsh-client-ui-slots'

/**
 * Run one command in a fixture directory.
 * @param cwd - directory to run in.
 * @param args - command and arguments.
 * @returns the exit code and the combined output, without throwing on a non-zero exit.
 */
async function runIn(cwd: string, args: readonly string[]): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await run(args[0] as string, args.slice(1), { cwd })
    return { code: 0, output: `${stdout}${stderr}` }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string; message?: string }
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}${failure.message ?? ''}`,
    }
  }
}

/** Compile a fixture's types and bundle it, exactly as a plugin's own build script does. */
async function build(name: string): Promise<{ code: number; output: string }> {
  const cwd = join(fixturesDir, name)
  const compiled = await runIn(cwd, ['pnpm', 'exec', 'tsc', '-b', 'tsconfig.json'])
  if (compiled.code !== 0) return compiled
  return await runIn(cwd, ['pnpm', 'exec', 'tsdown'])
}

/**
 * Build the fixture whose build is supposed to fail.
 *
 * It goes through the fixture's own script, and that script runs in an isolated process: the preset
 * caches the module baseline for the life of a process, and a build that is expected to throw would
 * otherwise leave that cache primed for every later test in this file. The script is also what wipes
 * the fixture's stale `tsc` build info, so a re-run cannot pass on a previous run's output.
 */
async function buildForbidden(): Promise<{ code: number; output: string }> {
  return await runIn(join(fixturesDir, FORBIDDEN), ['pnpm', 'run', 'build:forbidden'])
}

/** Read one of a fixture's build outputs as text. */
async function output(name: string, file: string): Promise<string> {
  return await readFile(join(fixturesDir, name, 'lib', file), 'utf8')
}

/** Remove a fixture's build output, so its build assertions cannot pass on a previous run's files. */
async function clean(name: string): Promise<void> {
  await rm(join(fixturesDir, name, 'lib'), { recursive: true, force: true })
}

/** Poll a predicate until it holds, or the deadline passes. */
async function until(holds: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await holds().catch(() => false)) return true
    if (Date.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/**
 * The watch loop the dev story depends on.
 *
 * An author runs one watcher and edits `src/client/`: `tsc -b --watch` republishes `lib/types/`, and
 * the bundle has to follow without a restart. The preset's source-map plugin serves those emitted
 * modules from a hook rather than letting rolldown read them, and rolldown does not watch a file it
 * never read — so without `addWatchFile` in that plugin, this loop silently stalls at the first edit.
 * That is the failure this test exists to catch, and it is a rebuild assertion, not a timing one: the
 * marker can only reach `client.js` by rebuilding it from the edited source.
 *
 * The fixture's own `watch` script is what runs, read out of its manifest rather than copied here, so
 * a script that stops producing a bundle fails this test too. It is started through `sh -c` instead of
 * `pnpm run`, because that is what makes the process group the shell's own — see {@link stopWatcher}.
 * @param name - the fixture to watch.
 */
async function expectWatchRebuild(name: string): Promise<void> {
  const cwd = join(fixturesDir, name)
  const source = join(cwd, 'src', 'client', 'index.ts')
  const bundle = join(cwd, 'lib', 'client.js')
  const manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  const script = manifest.scripts?.['watch']
  if (script === undefined) throw new Error(`${name}'s manifest declares no watch script`)

  // Seeded through the fixture's own build: `--watch` bundles what `tsc` emitted, and it does not
  // bootstrap a missing tree.
  const seeded = await build(name)
  expect(seeded.code, seeded.output).toBe(0)

  const original = await readFile(source, 'utf8')
  const watcher = spawn('sh', ['-c', script], { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let log = ''
  watcher.stdout?.on('data', (chunk: Buffer) => { log += chunk.toString() })
  watcher.stderr?.on('data', (chunk: Buffer) => { log += chunk.toString() })
  try {
    // Both halves have to be up before the edit: writing first would race an unstarted watcher, which
    // is a slower machine's flake rather than a real failure. `tsc --watch` announces itself, and a
    // tsdown run in watch mode says "Rebuilt" where a one-shot build says "Build complete".
    const watching = await until(
      async () => log.includes('Watching for file changes') && log.includes('Rebuilt'),
      30_000,
    )
    expect(watching, `the watchers never reported readiness:\n${log}`).toBe(true)

    // A fresh identifier per run: a bundle that still held a previous run's text would otherwise read
    // as a successful rebuild without anything having rebuilt. It goes into an assignment rather than
    // a trailing comment, because a comment attached to no statement is dropped by the bundler and
    // would never appear in `client.js` however often the bundle was rebuilt.
    const marker = `__watch_probe_${Date.now()}__`
    expect(original.includes(marker), 'the marker is already in the source').toBe(false)
    const edited = original.replace('globals.__helloApplied = true', `globals.__helloApplied = Boolean('${marker}')`)
    expect(edited, 'the fixture no longer contains the line this test edits').not.toBe(original)
    await writeFile(source, edited)

    const rebuilt = await until(async () => (await readFile(bundle, 'utf8')).includes(marker), 20_000)
    expect(rebuilt, `the bundle did not rebuild after the source changed:\n${log}`).toBe(true)
  } finally {
    // `detached` made the shell its own process group leader, so one signal reaches the shell, both
    // watchers it started, and anything they started in turn. Signalling only the shell would orphan
    // `tsdown --watch`, which then keeps rewriting the fixture's bundle under later tests.
    if (watcher.pid !== undefined) {
      try {
        process.kill(-watcher.pid, 'SIGTERM')
      } catch {
        // Already exited; nothing of ours is left running.
      }
    }
    await writeFile(source, original)
  }
}

/**
 * Execute a client bundle the way the shell does, and report what it registered.
 *
 * jsdom parses a script element but does not run it, so the loader is wired up first and the script
 * is then executed inside the document's own realm — which is the part that matters: the bundle has
 * to find `window` and `document` as globals, exactly as it will in a browser. Everything the bundle
 * records lands on that realm's global, so the tests read observations off the returned window.
 * @param code - the built `client.js`.
 * @returns the registrations, the document, and the realm they happened in.
 */
function executeBundle(code: string): { registered: Map<string, Factory>; window: Window & typeof globalThis } {
  // `runScripts: 'dangerously'` is what makes a script element execute at all; without it jsdom only
  // parses the text and the bundle would never reach `window.__ModuleLoader__`.
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    runScripts: 'dangerously',
  })
  const { window } = dom
  const registered = new Map<string, Factory>()
  Object.assign(window, {
    __ModuleLoader__: {
      load(registration: { id: string; factory: Factory }) {
        registered.set(registration.id, registration.factory)
      },
    },
  })
  const script = window.document.createElement('script')
  script.textContent = code
  window.document.head.appendChild(script)
  return { registered, window }
}

/** A module table answering the baseline with a stub; anything else is a failure the test wants. */
function moduleTable(): { table: Map<string, unknown>; calls: string[] } {
  const calls: string[] = []
  const table = new Map<string, unknown>([[SLOTS, { SlotCore: class SlotCore {} }]])
  return { table, calls }
}

/** The `require` a factory receives, recording what it asked for and refusing what it should not. */
function tableRequire(harness: { table: Map<string, unknown>; calls: string[] }): (specifier: string) => unknown {
  return (specifier: string) => {
    harness.calls.push(specifier)
    if (!harness.table.has(specifier)) throw new Error(`unexpected module-table request: ${specifier}`)
    return harness.table.get(specifier)
  }
}

/** The observations the fixture's `apply` recorded on the realm it ran in. */
function observations(window: Window & typeof globalThis): HelloObservations | undefined {
  return (window as Window & { __helloObservations?: HelloObservations }).__helloObservations
}

describe('clientBundle artifact contract', () => {
  it('builds exactly the two halves and a source map', async () => {
    await clean(HELLO)
    const built = await build(HELLO)
    expect(built.code).toBe(0)
    expect(built.output).toContain('Build complete')
    // `lib/` also holds tsc's own output (`types/`, the build info); the bundle's files are the plain
    // files beside them, and there must be exactly three — no `client2.js`, no second format.
    const entries = await readdir(join(fixturesDir, HELLO, 'lib'), { withFileTypes: true })
    const produced = entries.filter((entry) => entry.isFile() && entry.name.includes('.js')).map((entry) => entry.name)
    expect(produced.sort()).toEqual(['client.js', 'client.js.map', 'index.js'])
    // Two formats racing for one filename leave no trace in the file list, so the bytes have to prove
    // the CJS half won: a bundle carrying ESM statements is not a classic script, whatever it is named.
    expect(await output(HELLO, 'client.js')).not.toMatch(/^\s*(?:import|export)\s/m)
  })

  it('registers under the package name, not a /client variant', async () => {
    const { registered } = executeBundle(await output(HELLO, 'client.js'))
    expect([...registered.keys()]).toEqual(['dsh-plugin-hello-client'])
    expect(registered.get('dsh-plugin-hello-client')).toBeTypeOf('function')
  })

  it('hands baseline imports to the module table instead of inlining them', async () => {
    const { registered } = executeBundle(await output(HELLO, 'client.js'))
    const harness = moduleTable()
    // Executing the bundle must not require anything: a bundle that resolved its own imports at load
    // time would be reaching around the module table, which only answers during factory execution.
    expect(harness.calls).toEqual([])
    registered.get('dsh-plugin-hello-client')?.(tableRequire(harness))
    expect(harness.calls).toEqual([SLOTS])
  })

  it('applies, resolves the baseline, and reports both CSS injection forms', async () => {
    const { registered, window } = executeBundle(await output(HELLO, 'client.js'))
    const harness = moduleTable()
    const plugin = registered.get('dsh-plugin-hello-client')?.(tableRequire(harness))
    expect(plugin?.apply).toBeTypeOf('function')
    plugin?.apply({})

    expect((window as Window & { __helloApplied?: boolean }).__helloApplied).toBe(true)
    expect(observations(window)?.baselineResolved).toBe(true)

    // Both injecting forms own a tagged <style>; the host's hot reload keys on these attributes.
    const tags = [...window.document.querySelectorAll('style[data-plugin-css]')]
    const tagIds = tags.map((tag) => tag.getAttribute('data-plugin-css') ?? '').sort((a, b) => a.localeCompare(b))
    expect(tagIds).toEqual([
      'dsh-plugin-hello-client/global.css',
      'dsh-plugin-hello-client/greeting.module.css',
    ])
    for (const tag of tags) expect(tag.getAttribute('data-plugin')).toBe('dsh-plugin-hello-client')

    // CSS Modules export a hashed class map; the pattern keeps the local name readable.
    expect(Object.keys(observations(window)?.classMap ?? {})).toEqual(['greeting'])
    expect(observations(window)?.classMap['greeting']).toMatch(/_greeting$/)

    // `?inline` exports compiled text and injects nothing of its own. lightningcss hashes every class
    // it compiles, including a plain stylesheet's, so the assertion matches the hashed name.
    expect(observations(window)?.inlineText).toContain('_fixture-inline')
    expect(tags).toHaveLength(2)
  })

  it('does not inject a second copy when the factory runs twice', async () => {
    const { registered, window } = executeBundle(await output(HELLO, 'client.js'))
    const harness = moduleTable()
    const factory = registered.get('dsh-plugin-hello-client')
    factory?.(tableRequire(harness))
    factory?.(tableRequire(harness))
    expect(window.document.querySelectorAll('style[data-plugin-css]')).toHaveLength(2)
  })

  it('rebuilds under --watch when the emitted module changes', async () => {
    // Seeding, spawning the watcher and waiting for the rebuild do not fit the default 5s budget; the
    // test's own polls are the real bounds, and this only has to stay above their sum.
    await expectWatchRebuild(HELLO)
  }, 60_000)

  it('maps the bundle back to the original TypeScript, with its content', async () => {
    const map = JSON.parse(await output(HELLO, 'client.js.map')) as {
      sources?: string[]
      sourcesContent?: string[]
    }
    expect(map.sources?.every((source) => source.endsWith('.ts'))).toBe(true)
    expect(map.sourcesContent?.some((content) => content.includes('__helloApplied'))).toBe(true)
  })
})

describe('clientBundle failures', () => {
  it('refuses a cross-plugin value import', async () => {
    const built = await buildForbidden()
    expect(built.code).not.toBe(0)
    expect(built.output).toContain('client bundle purity')
    expect(built.output).toContain('@deepseek-ai/dsh-client-ui-session')
  })

  it('throws when a plugin declares a browser half but exports no ./client', async () => {
    const built = await runIn(join(fixturesDir, NO_CLIENT_EXPORT), ['pnpm', 'exec', 'tsdown'])
    expect(built.code).not.toBe(0)
    expect(built.output).toContain('exports no "./client" bundle')
  })

  it('throws at execution when the module table cannot answer a require', async () => {
    const { registered } = executeBundle(await output(HELLO, 'client.js'))
    const factory = registered.get('dsh-plugin-hello-client')
    expect(() => factory?.(() => {
      throw new Error('require("<id>") missed the module table')
    })).toThrow(/missed the module table/)
  })
})
