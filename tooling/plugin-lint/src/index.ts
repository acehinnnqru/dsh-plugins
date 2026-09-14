import { rules } from './rules.ts'
import type { Finding } from './types.ts'

export type { Finding, Rule } from './types.ts'

/** Lint one plugin directory's manifest. Always empty while the rule table is empty. */
export async function lintPlugin(dir: string): Promise<Finding[]> {
  const findings: Finding[] = []
  for (const rule of rules) {
    findings.push(...(await rule.check(dir)))
  }
  return findings
}
