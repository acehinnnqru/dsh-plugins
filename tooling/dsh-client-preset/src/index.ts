import { existsSync, readFileSync } from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import { dirname, join } from 'node:path'
import type { TsdownPlugin, UserConfig } from 'tsdown'
import { cssPlugins } from './css.ts'
import { platformBaseline } from './platform-modules.ts'
import { tscSourceMapPlugin } from './sourcemap.ts'

/**
 * Builds the two halves of a DSH plugin package in one `tsdown` run.
 *
 * A plugin that wants a browser half ships two entry points: a Node half the host Loader imports, and
 * a browser half the Web GUI fetches as a plain `<script>` and hands to `window.__ModuleLoader__`. The
 * upstream preset that emits the browser artifact lives in DSH's own repository and is not published,
 * so this is this repo's replacement for it.
 *
 * @module dsh-client-preset
 */

/** What the host needs from a plugin package's manifest, plus what this preset reads from it. */
interface PluginManifest {
  dsh?: { client?: { external?: unknown } }
  dependencies?: Record<string, string>
  exports?: unknown
}

/** Options the call site may add on top of what the manifest declares. */
export interface ClientBundleOptions {
  /**
   * Extra module-table requests, merged with `dsh.client.external`.
   *
   * Declaring them in the manifest is the supported route — the host has to know about a request
   * before it can sequence that row — so this is only for a package whose manifest cannot be read.
   */
  external?: readonly string[]
  /**
   * The browser half's entry, when it is not the emitted `lib/types/client/index.js`.
   *
   * The default is the compiled form of `src/client/index.ts`, which is what a package built by
   * `tsc -b` always has. Override it to bundle a source file directly, or a checked-in stub.
   */
  clientEntry?: string
}

/** The `dsh.client.external` list, when the manifest carries a well-formed one. */
function declaredExternals(id: string, manifest: PluginManifest): readonly string[] {
  const external = manifest.dsh?.client?.external
  if (external === undefined) return []
  if (!Array.isArray(external) || external.some((entry) => typeof entry !== 'string')) {
    throw new Error(`dsh-client-preset: ${id} declares dsh.client.external as something other than a string array`)
  }
  return external as readonly string[]
}

/**
 * The manifest the build should read: the package being built, else the installed one.
 *
 * tsdown evaluates this config with cwd set to the package directory, so the manifest sitting there
 * is the plugin actually being built. Reading it first is what lets a plugin that pnpm never linked
 * into the store build at all — a freshly generated one, or a workspace member nobody depends on.
 * The `require`-based lookup stays as the fallback for a caller building a package it does not sit in.
 * @param id - package name.
 * @returns the absolute path of the package manifest.
 * @throws when neither location has a manifest.
 */
function manifestPathFor(id: string): string {
  const local = join(process.cwd(), 'package.json')
  if (existsSync(local)) {
    const name = (JSON.parse(readFileSync(local, 'utf8')) as { name?: unknown }).name
    if (name === id) return local
  }
  return createRequire(import.meta.url).resolve(`${id}/package.json`)
}

/**
 * Locate the package `id` names and read the manifest facts the build depends on.
 * @param id - package name.
 * @param options - additional module-table requests.
 * @returns the package directory (the build's `cwd`) and its manifest.
 * @throws when the package cannot be resolved, or declares no `exports["./client"]`.
 */
function locatePlugin(id: string, options: ClientBundleOptions): { cwd: string; manifest: PluginManifest; external: readonly string[] } {
  let manifestPath: string
  try {
    manifestPath = manifestPathFor(id)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`dsh-client-preset: cannot resolve ${id}/package.json — the plugin must be the package being built or an installed package: ${detail}`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PluginManifest
  const clientExport = (manifest.exports as Record<string, unknown> | undefined)?.['./client']
  if (clientExport === undefined) {
    throw new Error(
      `dsh-client-preset: ${id} declares dsh.client but exports no "./client" bundle — the host resolves the `
      + 'artifact through exports["./client"], so the browser half would never be found',
    )
  }
  return {
    cwd: dirname(manifestPath),
    manifest,
    external: [...declaredExternals(id, manifest), ...(options.external ?? [])],
  }
}

/**
 * The build-time mirror of the module-table rules.
 *
 * A browser bundle may leave a specifier as `require()` only when the host's module table can answer
 * it. Everything else must be inlined — except the wire and contract layers below, which carry no
 * runtime identity and are meant to be inlined. Any other `@deepseek-ai/*` value import is a
 * cross-plugin value import: it either duplicates a singleton or produces a `require()` the table
 * cannot answer. Type-only imports never reach a bundler and are always fine.
 */
const INLINE_SAFE =
  /^(?:@deepseek-ai\/dsh-(?:file-reference|session|llm|tools|brand|deque|output-retention|typert-protocol|util-crypto|util-values|util-workspace-path)(?:\/|$)|@deepseek-ai\/dsh-token-meter\/client$|@deepseek-ai\/dsh-host-open-in-app\/shared$|@deepseek-ai\/dsh-agent-presets\/display$|@deepseek-ai\/dsh-spill-policy\/notice$)/

/** Vendored framework libraries are rescoped into `@deepseek-ai` but carry no plugin identity. */
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/

/** A generated Remote projection: the codec is the point, so it belongs in the bundle. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/**
 * Reject cross-plugin value imports at build time, before a bundle can ship a `require()` the host's
 * module table will refuse at runtime.
 * @param id - package name, for the error message.
 * @param externals - the module-table specifiers this package may leave external.
 * @returns the plugin.
 */
function purityGate(id: string, externals: ReadonlySet<string>): TsdownPlugin {
  return {
    name: 'dsh-client-bundle-purity',
    resolveId(source) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (externals.has(source)) return null
      if (VENDORED_LIBRARY.test(source)) return null
      if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not in the client baseline or ${id}'s dsh.client.external, `
        + 'an inline-safe wire layer, or a generated /remote contribution — cross-plugin value imports are '
        + 'forbidden; collaborate through cordis services or slots instead '
        + '(type-only imports are erased and never reach this gate)',
      )
    },
  }
}

/**
 * Build the tsdown configs for one plugin package: its Node half and its browser half.
 *
 * Both halves are stated in full. A package-level `tsdown.config.ts` is *merged* with the workspace
 * config, not substituted for it — tsdown runs the merge through `defu`, which concatenates arrays —
 * so anything left implicit here would be settled by whatever the root config happens to say.
 *
 * @param id - package name. Stamped into the `__ModuleLoader__.load` handoff, and used to find the
 * package's manifest and directory.
 * @param libEntry - the Node half's entry points. Exactly one: the contract names the artifact
 * `index.js`, and a second entry would compete for that filename.
 * @param options - module-table requests to add, and an override for the browser half's entry.
 * @returns the Node-half config and the browser-half config, in that order.
 * @throws when `libEntry` is not exactly one entry, when the package cannot be resolved, or when it
 * declares a browser half without the `exports["./client"]` the host reads.
 */
export function clientBundle(
  id: string,
  libEntry: readonly string[],
  options: ClientBundleOptions = {},
): UserConfig[] {
  const [nodeEntry] = libEntry
  if (libEntry.length !== 1 || nodeEntry === undefined) {
    throw new Error(
      `dsh-client-preset: clientBundle(${id}) needs exactly one Node-half entry, got ${libEntry.length} — `
      + 'the Node artifact is lib/index.js, so a second entry would be emitted under a different name',
    )
  }
  const { cwd, manifest, external } = locatePlugin(id, options)
  const { modules, preloaded } = platformBaseline()
  const externals = new Set([...modules, ...preloaded, ...external])
  const isModuleTableRow = (specifier: string): boolean => externals.has(specifier)
  // The Node half runs from a real install, where a production dependency is on disk: it stays an
  // import, and everything else (the plugin's own source included) is inlined. Stating both sides
  // keeps the artifact off tsdown's dependency-sniffing fallback, where moving a dependency between
  // `package.json` sections would silently change what the bundle contains.
  const production = new Set(Object.keys(manifest.dependencies ?? {}))
  const isProductionDependency = (specifier: string): boolean => {
    const name = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : (specifier.split('/')[0] ?? specifier)
    return production.has(name)
  }

  return [
    {
      cwd,
      name: `${id}/node`,
      // A plain string, not an array: tsdown refuses an array value under a non-glob object key.
      entry: { index: nodeEntry },
      outDir: 'lib',
      format: ['esm'],
      platform: 'node',
      target: 'es2024',
      fixedExtension: false,
      dts: false,
      clean: false,
      deps: {
        neverBundle: isProductionDependency,
        // Builtins are left to tsdown: neither side claims them.
        alwaysBundle: (specifier: string) => !isBuiltin(specifier) && !isProductionDependency(specifier),
      },
      outputOptions: { entryFileNames: 'index.js' },
    },
    {
      cwd,
      name: `${id}/client`,
      entry: { client: options.clientEntry ?? 'lib/types/client/index.js' },
      outDir: 'lib',
      format: ['cjs'],
      platform: 'browser',
      dts: false,
      clean: false,
      sourcemap: true,
      deps: {
        neverBundle: isModuleTableRow,
        alwaysBundle: (specifier: string) => !isModuleTableRow(specifier),
      },
      // A browser bundle inlines node-idiom dependencies that probe `process.env.NODE_ENV`, and some
      // also test `import.meta.env` before reading `.MODE`. A CJS output cannot carry `import.meta`,
      // so all three keys have to be substituted or the factory throws where it runs.
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'import.meta.env': JSON.stringify({ MODE: 'production' }),
        'import.meta.env.MODE': JSON.stringify('production'),
      },
      plugins: [purityGate(id, externals), tscSourceMapPlugin(), ...cssPlugins(id)],
      outputOptions: {
        entryFileNames: 'client.js',
        sourcemapExcludeSources: false,
        banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
        intro: 'var module = { exports: {} }; var exports = module.exports;',
        footer: 'return module.exports; } });',
      },
    },
  ]
}
