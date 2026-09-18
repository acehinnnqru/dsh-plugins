#!/usr/bin/env tsx
/**
 * Scaffold a plugin from `templates/plugin`:
 *
 *   pnpm new:plugin <name> [--ui] [--root <dir>]
 *
 * The generator only writes files — `pnpm install`, the build and the commit stay the human's steps.
 * The logic lives in `tooling/new-plugin`, so the smoke test can render without touching this repo.
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_VERSION } from '../tooling/dsh-compat/src/index.ts'
import { addPluginReference, normalizeName, packageName, writePlugin } from '../tooling/new-plugin/src/index.ts'

/** Repo root, derived from this script's own path so the working directory never matters. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const USAGE = 'usage: pnpm new:plugin <name> [--ui] [--root <dir>]'

/**
 * Read the command line.
 * @param argv - arguments after the script name.
 * @returns the plugin name, the variant and the repository root to write into.
 */
function parse(argv: string[]): { name: string; ui: boolean; root: string } {
  let root = ROOT
  let ui = false
  const positional: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--ui') {
      ui = true
    } else if (arg === '--root') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`--root needs a directory\n${USAGE}`)
      root = resolve(value)
      index += 1
    } else if (arg?.startsWith('--')) {
      throw new Error(`unknown option ${arg}\n${USAGE}`)
    } else if (arg !== undefined) {
      positional.push(arg)
    }
  }

  const [raw, ...extra] = positional
  if (raw === undefined || extra.length > 0) throw new Error(USAGE)
  return { name: normalizeName(raw), ui, root }
}

let options: ReturnType<typeof parse>
try {
  options = parse(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`✗ ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}

const { name, ui, root } = options
const dir = join(root, 'plugins', name)
if (existsSync(dir)) {
  process.stderr.write(`✗ plugins/${name} already exists\n`)
  process.exit(1)
}

const written = await writePlugin({ root, name, ui, dshVersion: DSH_VERSION })
const referenced = addPluginReference(root, name)

process.stdout.write(`✓ plugins/${name}  ${packageName(name)}${ui ? '  (with a browser half)' : ''}\n`)
for (const path of written) process.stdout.write(`  ${path}\n`)
if (referenced) process.stdout.write(`  added ./plugins/${name} to tsconfig.json references\n`)
process.stdout.write(`\nnext:\n  pnpm install\n  pnpm --filter ${packageName(name)} build\n  pnpm verify\n`)
