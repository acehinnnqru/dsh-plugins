#!/usr/bin/env tsx
/**
 * Pack every plugin with `pnpm pack --dry-run --json` and check the tarball listing against P1–P7.
 *
 * `--dry-run` is the whole mechanism: pnpm prints what would go into the tarball without writing one,
 * and that listing is exactly what a profile installs. The rules live in `tooling/pack-check`; this
 * file only walks `plugins/*` and reports.
 *
 * The cost is that lifecycle scripts (`prepack`) do not run. No plugin uses one; if that changes,
 * switch this to a real pack (see docs/specs/0003-local-install.md, "不做").
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { checkPack } from '../tooling/pack-check/src/index.ts'
import type { Finding, PackManifest } from '../tooling/pack-check/src/index.ts'

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

/** The part of `pnpm pack --dry-run --json` output this check reads. */
interface PackReport {
  name?: string
  version?: string
  files?: { path?: string }[]
}

type PackResult = { report: PackReport; error?: undefined } | { report?: undefined; error: string }

/** Runs in the package directory: the output is then a single object, not a `--filter` array. */
function pack(dir: string): PackResult {
  const done = spawnSync('pnpm', ['pack', '--dry-run', '--json'], { cwd: dir, encoding: 'utf8' })
  if (done.status !== 0) {
    const stderr = (done.stderr ?? '').trim()
    const detail = done.error?.message ?? stderr.split('\n').filter(Boolean).at(-1) ?? 'no output'
    return { error: `pnpm pack --dry-run --json failed (exit ${done.status ?? 'signal'}): ${detail}` }
  }
  try {
    return { report: JSON.parse(done.stdout) as PackReport }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { error: `pnpm pack --dry-run --json did not print JSON: ${detail}` }
  }
}

const dirs = await pluginDirs()
const problems: { dir: string; finding: Finding }[] = []
let filesChecked = 0

for (const dir of dirs) {
  const result = pack(dir)
  if (result.error !== undefined) {
    problems.push({ dir, finding: { rule: 'pack', file: 'package.json', message: result.error } })
    continue
  }

  const { report } = result
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackManifest
  const files = (report.files ?? [])
    .map((entry) => entry.path)
    .filter((path): path is string => typeof path === 'string')
  filesChecked += files.length

  const findings = checkPack({ dir, manifest, files })
  for (const finding of findings) problems.push({ dir, finding })
  if (findings.length === 0) {
    process.stdout.write(
      `✓ ${relative(ROOT, dir)}  ${report.name ?? '?'}@${report.version ?? '?'}  (${files.length} files)\n`,
    )
  }
}

for (const { dir, finding } of problems) {
  const where = relative(ROOT, join(dir, finding.file))
  process.stderr.write(`  ${finding.rule}  ${where}\n      ${finding.message}\n`)
}

if (problems.length > 0) {
  process.stderr.write(`\n✗ verify:pack: ${problems.length} problems across ${dirs.length} plugins\n`)
  process.exit(1)
}

process.stdout.write(`✓ verify:pack passed (${dirs.length} plugins, ${filesChecked} files checked)\n`)
