import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

/**
 * For building this package on its own. `cwd` has to be pinned: tsdown defaults to `process.cwd()`,
 * which during a whole-repo build is the repo root, so `lib/types/index.js` would resolve under the
 * root and fail on a missing entry.
 *
 * The emitted `lib/index.js` is not what plugins import — they get `src/index.ts` directly, because
 * tsdown executes a package's config file before it builds anything. This build exists so the
 * package is type-checked with the rest of the repo.
 *
 * The guard below is not decoration. This preset is consumed from its `./src/*` subpath, so when a
 * plugin's own build runs inside this package's tree, tsdown's config discovery walks up from the
 * plugin, finds *this* file, and takes it as the root config — silently replacing whatever the
 * plugin asked for. A config that is auto-discovered from a directory other than this package is
 * therefore never the intended build, and answering with an empty config list keeps it out of the
 * way instead of failing the caller with "No valid configuration found".
 */
export default defineConfig(() => {
  const here = dirname(fileURLToPath(import.meta.url))
  if (!existsSync(new URL('./package.json', import.meta.url))) return []
  return [
    {
      cwd: here,
      entry: ['lib/types/index.js'],
      outDir: 'lib',
      format: ['esm'],
      platform: 'node',
      target: 'es2024',
      fixedExtension: false,
      dts: false,
      clean: false,
    },
  ]
})
