import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'lib/types/index.js',
  format: 'esm',
  platform: 'node',
  outDir: 'lib',
  external: ['ws'],
  clean: false,
})
