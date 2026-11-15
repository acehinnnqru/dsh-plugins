import { rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Build the fixture the one way it can be built, in a fresh process.
 *
 * Its browser half is a checked-in stub that value-imports another feature plugin, so the build is
 * *supposed* to fail — the conformance test asserts that it does, and this script is what the test
 * runs. `pnpm -r build` must never reach it, which is why the package's `build` script does nothing
 * and this one is named separately.
 *
 * Two things happen here:
 *
 * 1. `lib/` is wiped, then the fixture's types are compiled with `tsc -b`. The stub lives under
 *    `stub/`, but the host half is ordinary compiled output, and a stale bundle could make a later
 *    assertion pass on the previous run's bytes.
 * 2. `tsdown` runs as a child process rather than in-process. The preset caches the module baseline
 *    for the life of a process, so a build that is expected to throw would otherwise leave that
 *    cache primed for every later test in the same worker.
 *
 * The exit status is this script's own status: the failure is the point, and the caller asserts on
 * how it failed.
 */
const here = dirname(fileURLToPath(import.meta.url))
const fixture = dirname(here)

// `new URL('../lib/', import.meta.url)` rather than a joined `import.meta.url` pathname: that
// pathname is percent-encoded, so it would not match a directory with a space in it.
rmSync(new URL('../lib/', import.meta.url), { recursive: true, force: true })

/** Run one command in the fixture directory and hand back its streams. */
function run(args: readonly string[]): ReturnType<typeof spawnSync> {
  return spawnSync(args[0] as string, args.slice(1), {
    cwd: fixture,
    encoding: 'utf8',
    // The fixture's own bin shims are shell scripts on POSIX and .cmd files on Windows.
    shell: process.platform === 'win32',
  })
}

const compiled = run([join(fixture, 'node_modules', '.bin', 'tsc'), '-b', 'tsconfig.json'])
process.stdout.write(compiled.stdout ?? '')
process.stderr.write(compiled.stderr ?? '')
if (compiled.status !== 0) process.exit(compiled.status ?? 1)

const built = run([join(fixture, 'node_modules', '.bin', 'tsdown')])
process.stdout.write(built.stdout ?? '')
process.stderr.write(built.stderr ?? '')
process.exit(built.status ?? 1)
