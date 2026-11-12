// The preset is imported by source, not by package name: tsdown *executes* this file before it
// builds anything, so a bare `from 'dsh-client-preset'` would read `lib/index.js` — an artifact this
// repo would then have to build first, and one that would ignore every later edit to the preset.
import { clientBundle } from 'dsh-client-preset/src/index.ts'

export default clientBundle('dsh-plugin-session-manager', ['lib/types/index.js'])
