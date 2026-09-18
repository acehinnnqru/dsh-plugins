#!/usr/bin/env tsx
/**
 * Run every check in order and stop at the first failure.
 *
 * This file only orchestrates; the actual rules live in each package's own script.
 */
import { spawn } from 'node:child_process'

interface Step {
  label: string
  args: [string, ...string[]]
}

const STEPS: Step[] = [
  // Build first: tsdown's entry is the output of `tsc -b` (`lib/types/index.js`), so without
  // this step no package that uses a tooling package can be built.
  { label: 'build', args: ['pnpm', 'build'] },
  { label: 'lint', args: ['pnpm', 'lint'] },
  { label: 'typecheck', args: ['pnpm', 'typecheck'] },
  { label: 'plugin-lint', args: ['pnpm', 'plugin-lint'] },
  // After plugin-lint (static rules first) and after build (the listing must come from fresh output).
  { label: 'pack', args: ['pnpm', 'verify:pack'] },
  // Before the tests: a bundle built against a stale module baseline would surface as a confusing
  // test failure, and this step names the specifier that drifted.
  { label: 'platform-modules', args: ['pnpm', 'verify:platform-modules'] },
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
    process.stdout.write(`\n✗ ${step.label} failed with exit code ${code} (${(ms / 1000).toFixed(1)}s)\n`)
    process.exit(code)
  }

  process.stdout.write(`✓ ${step.label} passed (${(ms / 1000).toFixed(1)}s)\n`)
}

process.stdout.write('\n---------------- verify ----------------\n')
// Sized from the labels in play, so adding a longer step never silently breaks the column.
const width = Math.max(...results.map(({ label }) => label.length)) + 2
for (const { label, ms } of results) {
  process.stdout.write(`  ${label.padEnd(width)}${(ms / 1000).toFixed(1)}s\n`)
}
process.stdout.write(`✓ all green (${STEPS.length} steps, ${(results.reduce((sum, r) => sum + r.ms, 0) / 1000).toFixed(1)}s total)\n`)
