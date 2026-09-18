import { defineConfig } from 'tsdown'
// Imported by source, the way a plugin author would: the preset is consumed from its `./src/*`
// subpath, so a fixture that loaded built output would stop proving that path still works.
import { clientBundle } from 'dsh-client-preset/src/index.ts'

export default defineConfig(clientBundle('dsh-plugin-hello-client', ['lib/types/index.js']))
