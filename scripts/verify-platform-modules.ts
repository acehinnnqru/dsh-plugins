#!/usr/bin/env tsx
/**
 * Check the browser module baseline this repo assumes against the one the installed
 * `@deepseek-ai/dsh-client-web` actually declares.
 *
 * The baseline is the set of specifiers DSH's shell freezes into its module table, so it is the list
 * a client bundle may leave as `require()`. The preset reads the live list at build time; this check
 * is about the copy kept in the repo, which is what a reader of the code sees and what tells a
 * future upgrade that the list moved.
 *
 * A moved entry is a real incompatibility, not a formatting difference: a removed specifier makes
 * every plugin that imports it fail the purity gate, and an added one is a module the shell now
 * shares that this repo does not know about.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { EXPECTED_PLATFORM_MODULES } from '../tooling/dsh-client-preset/src/platform-modules.ts'

const require = createRequire(import.meta.url)
const CLIENT_WEB_PACKAGE = '@deepseek-ai/dsh-client-web'

/** Extract an exported `readonly ["a", "b"]` tuple from a declaration file. */
function readStringTuple(source: string, name: string): readonly string[] {
  const declaration = new RegExp(`export declare const ${name}:\\s*readonly\\s*(\\[[^\\]]*\\])`).exec(source)
  const literal = declaration?.[1]
  if (literal === undefined) throw new Error(`${name} is not declared as a readonly tuple`)
  const parsed = JSON.parse(literal) as unknown
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${name} is declared with a non-string entry`)
  }
  return parsed as readonly string[]
}

// Reached through `./package.json`, the one subpath the package exports: `./lib/*` is refused by its
// exports map even though the file is on disk.
const manifestPath = require.resolve(`${CLIENT_WEB_PACKAGE}/package.json`)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: string }
const declarationPath = join(dirname(manifestPath), 'lib/types/platform.d.ts')

let upstream: readonly string[]
try {
  upstream = readStringTuple(readFileSync(declarationPath, 'utf8'), 'PLATFORM_MODULES')
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error)
  process.stderr.write(`✗ cannot read the module baseline from ${CLIENT_WEB_PACKAGE}: ${detail}\n`)
  process.exit(1)
}

const missing = EXPECTED_PLATFORM_MODULES.filter((specifier) => !upstream.includes(specifier))
const added = upstream.filter((specifier) => !EXPECTED_PLATFORM_MODULES.includes(specifier))

if (missing.length > 0 || added.length > 0) {
  process.stderr.write(
    `✗ the browser module baseline in tooling/dsh-client-preset/src/platform-modules.ts disagrees with `
    + `${CLIENT_WEB_PACKAGE}@${manifest.version ?? 'unknown'}:\n\n`,
  )
  for (const specifier of missing) {
    process.stderr.write(`  ${specifier}  is in EXPECTED_PLATFORM_MODULES but no longer in the upstream baseline\n`)
  }
  for (const specifier of added) {
    process.stderr.write(`  ${specifier}  is in the upstream baseline but missing from EXPECTED_PLATFORM_MODULES\n`)
  }
  process.stderr.write('\nUpdate EXPECTED_PLATFORM_MODULES to match, then check whether the preset still builds.\n')
  process.exit(1)
}

process.stdout.write(`${CLIENT_WEB_PACKAGE}   ${manifest.version ?? 'unknown'}\n`)
process.stdout.write(`✓ module baseline agrees (${upstream.length} specifiers)\n`)
