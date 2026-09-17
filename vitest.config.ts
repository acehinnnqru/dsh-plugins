import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * `root` is pinned to the repo, not left as `process.cwd()`. Vitest resolves `include` against the
 * root, so without this, running `vitest run tests` from inside a package (cwd = plugins/<name>)
 * looks for `plugins/<name>/plugins/<name>/tests/...` and finds nothing. Pinned, a package-scoped
 * run and a whole-repo run select the same files.
 */
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  test: {
    include: ['{plugins,packages,tooling}/*/tests/**/*.spec.ts'],
    environment: 'node',
  },
})
