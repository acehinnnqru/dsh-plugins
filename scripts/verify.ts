#!/usr/bin/env tsx
/**
 * 顺序跑全部校验，第一个失败就停。
 *
 * 这里只编排；每一步的实际规则在各包自己的脚本里。
 */
import { spawn } from 'node:child_process'

interface Step {
  label: string
  args: [string, ...string[]]
}

const STEPS: Step[] = [
  // 先构建：tsdown 的入口是 `tsc -b` 的产物（`lib/types/index.js`），
  // 没有这一步，任何用了工具包的包都打不出来。
  { label: 'build', args: ['pnpm', 'build'] },
  { label: 'lint', args: ['pnpm', 'lint'] },
  { label: 'typecheck', args: ['pnpm', 'typecheck'] },
  { label: 'plugin-lint', args: ['pnpm', 'plugin-lint'] },
  { label: 'test', args: ['pnpm', 'test'] },
]

function run(args: [string, ...string[]]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
}

const results: { label: string; ms: number }[] = []

for (const step of STEPS) {
  process.stdout.write(`\n==> ${step.label} (${step.args.join(' ')})\n`)
  const startedAt = Date.now()
  const code = await run(step.args)
  const ms = Date.now() - startedAt
  results.push({ label: step.label, ms })

  if (code !== 0) {
    process.stdout.write(`\n✗ ${step.label} 失败，退出码 ${code}（${(ms / 1000).toFixed(1)}s）\n`)
    process.exit(code)
  }

  process.stdout.write(`✓ ${step.label} 通过（${(ms / 1000).toFixed(1)}s）\n`)
}

process.stdout.write('\n---------------- verify ----------------\n')
for (const { label, ms } of results) {
  process.stdout.write(`  ${label.padEnd(12)}${(ms / 1000).toFixed(1)}s\n`)
}
process.stdout.write(`✓ 全绿（${STEPS.length} 步，共 ${(results.reduce((sum, r) => sum + r.ms, 0) / 1000).toFixed(1)}s）\n`)
