import { rules } from './rules.ts'
import type { Finding } from './types.ts'

export type { Finding, Rule } from './types.ts'

/** 校验一个插件目录的清单。没有任何规则时恒为空。 */
export async function lintPlugin(dir: string): Promise<Finding[]> {
  const findings: Finding[] = []
  for (const rule of rules) {
    findings.push(...(await rule.check(dir)))
  }
  return findings
}
