import { defineConfig } from 'tsdown'

export default defineConfig({
  workspace: ['plugins/*', 'packages/*', 'tooling/*'],
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
