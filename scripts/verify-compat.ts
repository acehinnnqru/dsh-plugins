#!/usr/bin/env tsx
/**
 * 校验各插件声明的 `@deepseek-ai/*` 版本与本仓库锁定的 DSH 版本一致。
 *
 * 版本常量只有 `tooling/dsh-compat/src/index.ts` 一处；这里只做对照。
 * 现在还没有插件，所以只会打印当前锁定的版本。
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
 * `0.1.5-rc.1` → `0.1.5`。
 *
 * 只比较 `major.minor.patch`：DSH 每个版本都是预发布，`rc.N` 是上游自己的
 * 构建序号，换一个不该让全仓库红。版本线换了才是真的不兼容。
 */
function releaseLine(version: string): string {
  return version.split('-')[0] ?? version
}

/** 声明了 `@deepseek-ai/*` 的每个清单段。 */
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
      // peer 包（cordis）的版本线和 DSH 是分开的，由 plugin-lint 的 L4 管。
      if (PEER_PACKAGES.some((peer) => peer === pkg)) continue
      if (releaseLine(actual) === releaseLine(DSH_VERSION)) continue

      mismatches.push({ file, section, pkg, actual })
    }
  }
}

if (mismatches.length > 0) {
  process.stderr.write('✗ 以下声明与 tooling/dsh-compat 的常量不一致：\n\n')
  for (const { file, section, pkg, actual } of mismatches) {
    process.stderr.write(`  ${file}  ${section}.${pkg} = ${actual}（期望 ${DSH_VERSION}）\n`)
  }
  process.stderr.write('\n升级 DSH 时改 tooling/dsh-compat/src/index.ts，再同步到各插件。\n')
  process.exit(1)
}

process.stdout.write(`DSH_VERSION           ${DSH_VERSION}\n`)
process.stdout.write(`PEER_PACKAGES         ${PEER_PACKAGES.join(', ')}\n`)
process.stdout.write(`DEPENDENCY_ALLOWLIST  ${DEPENDENCY_ALLOWLIST.join(', ')}\n`)
process.stdout.write(`✓ 版本一致（检查了 ${pluginCount} 个插件）\n`)
