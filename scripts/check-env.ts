#!/usr/bin/env tsx
/**
 * 环境哨兵：确认当前 shell 用的是 `flake.nix` 声明的 devshell 里的 node / pnpm。
 *
 * 为什么需要：外层 shell 可能已经继承了**别的仓库**（例如 DSH checkout）的 devshell。
 * 那种环境下 pnpm 照样能跑，但工具链是别人的，验收结果不可信 —— lint 的
 * `oxlint-tsgolint` 缺失就是这么漏过去的。
 *
 * 判据是「PATH 上的 node 解析到哪」，不是 `process.execPath`：pnpm 跑脚本时用的是
 * pnpm 自带的 slim node（`/nix/store/*-nodejs-slim-*`），不是 devshell 那个。
 * 真正决定 `tsc` / `tsx` / `vitest` 用哪个 node 的，是 PATH。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const HINT = [
  '本仓库的 node / pnpm 只来自 flake.nix 的 devshell。请用：',
  '',
  '    direnv exec . pnpm <script>',
  '',
  '（首次进入需要 `direnv allow`；没装 direnv 就用 `nix develop`）',
].join('\n')

function fail(lines: string[]): never {
  process.stderr.write(`\n✗ 环境哨兵未通过\n\n${lines.join('\n')}\n\n${HINT}\n`)
  process.exit(1)
}

/**
 * devshell 的 bin 目录 —— 从 direnv 生成的 profile 里读。
 *
 * 注意 `.direnv/flake-profile-*` 本身是个文件（nix-shell-env 的 JSON），不是目录，
 * 所以不能拼 `<profile>/bin/node`。真正的答案在 `.rc` 的 PATH 行里。
 */
function devshellBinDir(): string | undefined {
  let files: string[]
  try {
    files = readdirSync(join(ROOT, '.direnv'))
  } catch {
    return undefined
  }

  const rc = files.find((name) => name.startsWith('flake-profile-') && name.endsWith('.rc'))
  if (rc === undefined) return undefined

  const line = /^PATH='([^']*)'/m.exec(readFileSync(join(ROOT, '.direnv', rc), 'utf8'))
  if (line?.[1] === undefined) return undefined

  return line[1]
    .split(':')
    .map((entry) => entry.trim())
    .find((entry) => entry.includes('nodejs-'))
}

/** PATH 上某个命令解析到的绝对路径，找不到返回 undefined。 */
function resolve(cmd: string): string | undefined {
  try {
    const out = execFileSync('/bin/sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' })
    return out.trim() || undefined
  } catch {
    return undefined
  }
}

if (process.env['DSH_SKIP_ENV_CHECK'] === '1') {
  process.stdout.write('✓ 环境哨兵已跳过（DSH_SKIP_ENV_CHECK=1）\n')
  process.exit(0)
}

const binDir = devshellBinDir()
if (binDir === undefined) {
  fail([
    '读不到本目录 devshell 的 node 路径（缺 .direnv/flake-profile-*.rc）。',
    '',
    '先执行：  direnv allow',
    '没装 direnv：  nix develop',
  ])
}

const node = resolve('node')
if (node === undefined) fail(['PATH 上找不到 node。'])

const expected = `${binDir}/node`
if (node !== expected) {
  fail([
    `PATH 上的 node:     ${node}`,
    `devshell 期望的 node: ${expected}`,
    '',
    '两者不同 —— 现在用的不是本仓库 devshell（多半是从外层 shell 继承来的）。',
  ])
}

const pnpm = resolve('pnpm')
if (pnpm === undefined) fail(['PATH 上找不到 pnpm。'])
// 外层的 pnpm 可能是某个仓库按 packageManager 自管理装下来的那份，
// 路径不在 /nix/store 下（例如 ~/Library/pnpm/store/v11/links/@/pnpm/...）。
if (!pnpm.startsWith('/nix/store/')) {
  fail([`PATH 上的 pnpm 不是 devshell 提供的：${pnpm}`])
}

process.stdout.write(`✓ 环境哨兵通过\n  node  ${node}\n  pnpm  ${pnpm}\n`)
