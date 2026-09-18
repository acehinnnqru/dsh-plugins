import { defineConfig } from 'tsdown'
import { clientBundle } from 'dsh-client-preset/src/index.ts'

// The browser half value-imports a plugin package the module table cannot answer, and that is not an
// inline-safe wire layer, so the preset's purity gate has to reject the build. `clientEntry` points
// at the checked-in stub because that source half deliberately cannot be compiled.
export default defineConfig(clientBundle('dsh-plugin-forbidden-import', ['lib/types/index.js'], {
  clientEntry: 'stub/forbidden-client.js',
}))
