import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * The browser module baseline: the specifiers DSH's shell freezes into its module table and therefore
 * the only ones a plugin's client bundle may leave as `require()` calls.
 *
 * Read from the installed `@deepseek-ai/dsh-client-web`, never hand-copied — the list moves with the
 * DSH release and a stale copy would make a bundle that builds here and throws in the browser.
 */
export type PlatformModules = readonly string[]

/** Module-table specifiers the shell preloads before it starts; reserved for shell-owned rows. */
export type PreloadedClientExternals = readonly string[]

/**
 * The copy of the baseline that ships in this repo, used only as an expected value by
 * `pnpm verify:platform-modules` and by the tests: the preset always prefers what it reads from the
 * published package, and this constant going stale is exactly what that check reports.
 *
 * Source: `@deepseek-ai/dsh-client-web@0.2.1-alpha.5` `lib/types/platform.d.ts`.
 */
export const EXPECTED_PLATFORM_MODULES: PlatformModules = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/**
 * The declaration file that carries the baseline tuple, relative to the package root.
 *
 * Resolved by locating the package and reading the file, not by `require.resolve` on this path: the
 * package's `exports` map does not expose `./lib/*`, so a subpath resolution is refused even though
 * the file is right there on disk.
 */
const PLATFORM_DTS = 'lib/types/platform.d.ts'

/** The package that owns the baseline. */
const CLIENT_WEB_PACKAGE = '@deepseek-ai/dsh-client-web'

/**
 * The version this repo pins in `package.json`, quoted in the failure message so a missing install
 * names the release it wanted. Not imported from `tooling/dsh-compat`: a preset a plugin installs
 * from git must not reach into this repo's unpublished internals, and the pin that actually governs
 * the read is this package's own `devDependencies`.
 */
const PINNED_RELEASE = '0.2.1-alpha.5'

/**
 * Resolve a module specifier the way this preset's own dependencies would, so the version read here is
 * the version `package.json` pins — not whatever another package in the tree happens to hoist.
 */
function presetRequire(): NodeJS.Require {
  return createRequire(import.meta.url)
}

/**
 * Extract an exported `readonly ["a", "b"]` tuple from a `.d.ts` file.
 * @param source - declaration file contents.
 * @param name - exported constant to read.
 * @returns the tuple's elements, in declaration order.
 * @throws when the declaration is absent or is not a tuple of string literals.
 */
function readStringTuple(source: string, name: string): readonly string[] {
  const declaration = new RegExp(`export declare const ${name}:\\s*readonly\\s*(\\[[^\\]]*\\])`).exec(source)
  const literal = declaration?.[1]
  if (literal === undefined) {
    throw new Error(`dsh-client-preset: ${PLATFORM_DTS} does not declare ${name} as a readonly tuple`)
  }
  let parsed: unknown
  try {
    // A tuple of string literals is already valid JSON; anything else must fail loudly rather than
    // silently produce a half-read baseline.
    parsed = JSON.parse(literal)
  } catch {
    throw new Error(`dsh-client-preset: ${PLATFORM_DTS} declares ${name} in a form this preset cannot read: ${literal}`)
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new Error(`dsh-client-preset: ${PLATFORM_DTS} declares ${name} with a non-string entry`)
  }
  return parsed as readonly string[]
}

/** Cache the read: every package in one build shares one baseline, and it cannot change mid-build. */
let cachedBaseline: { modules: PlatformModules; preloaded: PreloadedClientExternals } | undefined

/**
 * The declaration file's absolute path, found through the one subpath the package does export.
 * @returns the path to read.
 * @throws when the package is not installed.
 */
function platformDeclarationPath(): string {
  const require = presetRequire()
  // `./package.json` is always exported, which makes it the supported anchor for reaching a file
  // inside an installed package whose other subpaths are not exported.
  const manifestPath = require.resolve(`${CLIENT_WEB_PACKAGE}/package.json`)
  return join(dirname(manifestPath), PLATFORM_DTS)
}

/**
 * Read the browser module baseline out of the installed `@deepseek-ai/dsh-client-web`.
 *
 * The package's `exports` map advertises `./src/*`, but its published tarball ships only `lib/` and
 * `lib/types/` — `files` leaves `src` out — so the declaration file is the only readable source.
 * @returns the baseline tuple and the preload list, both in upstream order.
 * @throws when the package is not installed, or its declaration is unreadable in the expected shape.
 */
export function platformBaseline(): { modules: PlatformModules; preloaded: PreloadedClientExternals } {
  if (cachedBaseline !== undefined) return cachedBaseline
  let declaration: string
  try {
    declaration = readFileSync(platformDeclarationPath(), 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `dsh-client-preset: cannot read the browser module baseline from ${CLIENT_WEB_PACKAGE} `
      + `(pinned to ${PINNED_RELEASE}): ${detail}`,
    )
  }
  cachedBaseline = {
    modules: readStringTuple(declaration, 'PLATFORM_MODULES'),
    preloaded: readStringTuple(declaration, 'PRELOADED_CLIENT_EXTERNALS'),
  }
  return cachedBaseline
}
