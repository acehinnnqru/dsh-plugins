import { defineConfig } from 'tsdown'
import { clientBundle } from 'dsh-client-preset/src/index.ts'

// Declares dsh.client but ships no ./client export, so the preset must refuse to build rather than
// emit an artifact the host has no way to address.
export default defineConfig(clientBundle('dsh-plugin-no-client-export', ['lib/types/index.js']))
