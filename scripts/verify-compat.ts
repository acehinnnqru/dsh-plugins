#!/usr/bin/env tsx
/**
 * Check that every plugin declares the same `@deepseek-ai/*` versions as the DSH version this repo pins.
 *
 * The version constants live in exactly one place, `tooling/dsh-compat/src/index.ts`; this only compares
 * against them. There are no plugins yet, so for now it just prints the pinned versions.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  DEPENDENCY_ALLOWLIST,
  DSH_VERSION,
  PEER_PACKAGES,
} from '../tooling/dsh-compat/src/index.ts'

const ROOT = process.cwd()
const PLUGINS_DIR = join(ROOT, 'plugins')

/**
 * `0.1.5-rc.1` → `0.1.5`.
 *
 * Only `major.minor.patch` is compared: every DSH release is a prerelease and `rc.N` is upstream's own
 * build number, so bumping it must not turn the whole repo red. A change of version line is the real
 * incompatibility.
 */
function releaseLine(version: string): string {
  return version.split('-')[0] ?? version
}

/** Every manifest section that can declare `@deepseek-ai/*`. */
const SECTIONS = ['dependencies', 'peerDependencies', 'devDependencies'] as const

interface Mismatch {
  file: string
  section: string
  pkg: string
  actual: string
}

async function pluginDirs(): Promise<string[]> {
  if (!existsSync(PLUGINS_DIR)) return []
  const entries = await readdir(PLUGINS_DIR, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(PLUGINS_DIR, entry.name))
    .sort()
}

const mismatches: Mismatch[] = []
let pluginCount = 0

for (const dir of await pluginDirs()) {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) continue
  pluginCount += 1

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
    string,
    Record<string, string> | undefined
  >
  const file = relative(ROOT, manifestPath)

  for (const section of SECTIONS) {
    for (const [pkg, actual] of Object.entries(manifest[section] ?? {})) {
      if (!pkg.startsWith('@deepseek-ai/')) continue
      // The peer package (cordis) is on a version line of its own, separate from DSH; rule L4 covers it.
      if (PEER_PACKAGES.some((peer) => peer === pkg)) continue
      if (releaseLine(actual) === releaseLine(DSH_VERSION)) continue

      mismatches.push({ file, section, pkg, actual })
    }
  }
}

if (mismatches.length > 0) {
  process.stderr.write('✗ these declarations disagree with the constants in tooling/dsh-compat:\n\n')
  for (const { file, section, pkg, actual } of mismatches) {
    process.stderr.write(`  ${file}  ${section}.${pkg} = ${actual} (expected ${DSH_VERSION})\n`)
  }
  process.stderr.write('\nWhen upgrading DSH, edit tooling/dsh-compat/src/index.ts and sync every plugin.\n')
  process.exit(1)
}

process.stdout.write(`DSH_VERSION           ${DSH_VERSION}\n`)
process.stdout.write(`PEER_PACKAGES         ${PEER_PACKAGES.join(', ')}\n`)
process.stdout.write(`DEPENDENCY_ALLOWLIST  ${DEPENDENCY_ALLOWLIST.join(', ')}\n`)
process.stdout.write(`✓ versions agree (checked ${pluginCount} plugins)\n`)
