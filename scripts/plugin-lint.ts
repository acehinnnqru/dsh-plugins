#!/usr/bin/env tsx
/**
 * 遍历 `plugins/*`，对每个插件的清单跑一遍规则，汇总输出。
 *
 * 规则表在 `tooling/plugin-lint`（0002 里填）。这一版是空壳：
 * 没有任何插件、也没有任何规则，所以直接通过。
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
  process.stderr.write(`\n✗ plugin-lint：${all.length} 个问题，涉及 ${dirs.length} 个插件\n`)
  process.exit(1)
}

process.stdout.write(`✓ plugin-lint 通过（${dirs.length} 个插件，0 个问题）\n`)
