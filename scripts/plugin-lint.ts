#!/usr/bin/env tsx
/**
 * Walk `plugins/*`, run the rules against each plugin's manifest, and report the findings together.
 *
 * The rule table lives in `tooling/plugin-lint`. This version is a shell: there are no plugins and no
 * rules yet, so it always passes.
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { lintPlugin } from '../tooling/plugin-lint/src/index.ts'
import type { Finding } from '../tooling/plugin-lint/src/types.ts'

const ROOT = process.cwd()
const PLUGINS_DIR = join(ROOT, 'plugins')

async function pluginDirs(): Promise<string[]> {
  if (!existsSync(PLUGINS_DIR)) return []
  const entries = await readdir(PLUGINS_DIR, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(PLUGINS_DIR, entry.name))
    .sort()
}

const dirs = await pluginDirs()
const all: { dir: string; finding: Finding }[] = []

for (const dir of dirs) {
  for (const finding of await lintPlugin(dir)) {
    all.push({ dir, finding })
  }
}

for (const { dir, finding } of all) {
  const where = relative(ROOT, join(dir, finding.file))
  process.stderr.write(`  ${finding.rule}  ${where}\n      ${finding.message}\n`)
}

if (all.length > 0) {
  process.stderr.write(`\n✗ plugin-lint: ${all.length} problems across ${dirs.length} plugins\n`)
  process.exit(1)
}

process.stdout.write(`✓ plugin-lint passed (${dirs.length} plugins, 0 problems)\n`)
