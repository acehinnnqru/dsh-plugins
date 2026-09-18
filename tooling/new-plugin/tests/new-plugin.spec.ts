/**
 * The anti-rot test: generate both variants and actually build them.
 *
 * Linting alone cannot catch template rot — plugin-lint only has L7 today, and a host-half plugin
 * has no browser half for L7 to check. What breaks is the build: a missing `tsdown.config.ts`, a
 * `.ts` entry holding JSX, a missing UI dependency. So each variant is rendered into a temporary
 * directory under `plugins/`, compiled, bundled, packed and linted, exactly like a real plugin.
 *
 * The temporary directory is a dot directory on purpose: pnpm's workspace globs skip it, so the
 * lockfile is never touched, and `node_modules` is a symlink into the already-installed `plugins/now`.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DSH_VERSION } from '../../dsh-compat/src/index.ts'
import { checkPack, type PackManifest } from '../../pack-check/src/index.ts'
import { lintPlugin } from '../../plugin-lint/src/index.ts'
import { addPluginReference, packageName, writePlugin } from '../src/index.ts'

/** Repo root: this file lives at `<root>/tooling/new-plugin/tests/`. */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
/** The devshell's binaries, as pnpm links them at the repo root. */
const BIN = join(ROOT, 'node_modules', '.bin')
/** `plugins/now` depends on everything both variants need — host and browser alike. */
const DEPENDENCIES = join(ROOT, 'plugins', 'now', 'node_modules')

/** The part of `pnpm pack --dry-run --json` this test reads. */
interface PackReport {
  files?: { path?: string }[]
}

/**
 * Run one command; a non-zero exit fails the test with the output attached.
 * @param command - executable to run.
 * @param args - its arguments.
 * @param cwd - working directory.
 * @param env - extra environment; merged over the inherited one.
 * @returns its stdout.
 */
function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  const done = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
  if (done.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (exit ${done.status ?? 'signal'}):\n${done.stdout ?? ''}${done.stderr ?? ''}`,
    )
  }
  return done.stdout
}

/**
 * Generate one variant, then compile, bundle, pack and lint it.
 * @param name - bare plugin name for the throwaway plugin.
 * @param ui - whether to render the browser half.
 */
async function smoke(name: string, ui: boolean): Promise<void> {
  const dir = join(ROOT, 'plugins', `.smoke-${name}-${process.pid}`)
  rmSync(dir, { recursive: true, force: true })
  try {
    await writePlugin({ root: ROOT, name, ui, dshVersion: DSH_VERSION, dir })
    symlinkSync(DEPENDENCIES, join(dir, 'node_modules'), 'dir')

    // The preset resolves the plugin by *package name* from its own location, which an uninstalled
    // plugin cannot satisfy through `node_modules` alone. This NODE_PATH entry holds nothing but a
    // link back to the plugin, so `dsh-client-preset` finds it without pnpm linking a workspace member.
    mkdirSync(join(dir, '.resolve'))
    symlinkSync('..', join(dir, '.resolve', packageName(name)))

    run(join(BIN, 'tsc'), ['-b', 'tsconfig.json'], dir)
    run(join(BIN, 'tsdown'), [], dir, { NODE_PATH: join(dir, '.resolve') })
    expect(existsSync(join(dir, 'lib', 'index.js')), 'the host bundle').toBe(true)
    if (ui) expect(existsSync(join(dir, 'lib', 'client.js')), 'the browser bundle').toBe(true)

    const report = JSON.parse(run('pnpm', ['pack', '--dry-run', '--json'], dir)) as PackReport
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackManifest
    const files = (report.files ?? []).flatMap((entry) => (typeof entry.path === 'string' ? [entry.path] : []))
    expect(checkPack({ dir, manifest, files })).toEqual([])

    expect(await lintPlugin(dir)).toEqual([])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('plugin template', () => {
  it('renders a host-half plugin that builds, packs and lints', async () => {
    await smoke('smoke', false)
  }, 120_000)

  it('renders a UI plugin that builds, packs and lints', async () => {
    await smoke('smoke-ui', true)
  }, 120_000)

  it('adds the tsconfig reference as one line, without reformatting the file', () => {
    const root = mkdtempSync(join(tmpdir(), 'new-plugin-'))
    try {
      const original = readFileSync(join(ROOT, 'tsconfig.json'), 'utf8')
      writeFileSync(join(root, 'tsconfig.json'), original)

      expect(addPluginReference(root, 'probe')).toBe(true)
      expect(addPluginReference(root, 'probe')).toBe(false)

      const after = readFileSync(join(root, 'tsconfig.json'), 'utf8')
      // Re-serializing the whole file would expand every reference object; one extra line is the
      // signal that the rest of the file survived untouched.
      expect(after.split('\n').length).toBe(original.split('\n').length + 1)
      expect(after).toContain('{ "path": "./plugins/probe" },')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
