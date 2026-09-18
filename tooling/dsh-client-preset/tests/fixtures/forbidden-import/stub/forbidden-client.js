// Hand-written on purpose. `tsc` cannot compile this import without resolving it, and the whole point
// of the fixture is that the build must reject the specifier before the module table ever sees it —
// so the browser half is a checked-in stub the fixture's tsdown.config.ts points at directly.
import { createController } from '@deepseek-ai/dsh-client-ui-session'

export function apply() {
  void createController
}
