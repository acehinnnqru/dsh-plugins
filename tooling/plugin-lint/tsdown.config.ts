import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

/**
 * 单包构建用。根 `tsdown.config.ts` 的 `workspace` 是给根目录整仓构建用的：
 * `tsdown` 的 workspace glob 相对 cwd 解析，在包目录里跑会匹配不到任何包。
 *
 * `cwd` 必须显式写死——tsdown 默认用 `process.cwd()`，整仓构建时那会是仓库根目录，
 * 于是 `lib/types/index.js` 会被解析到根目录下而报找不到入口。
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
