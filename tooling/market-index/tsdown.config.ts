import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

/**
 * For building a single package. The `workspace` in the root `tsdown.config.ts` is for building the
 * whole repo from the root: tsdown resolves workspace globs relative to cwd, so running it inside a
 * package directory matches no packages at all.
 */
export default defineConfig({
  cwd: dirname(fileURLToPath(import.meta.url)),
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
