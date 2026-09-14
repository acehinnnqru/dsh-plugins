import type { Rule } from './types.ts'

/**
 * The manifest rule table. Only the skeleton exists so far; the rules are written as plugins arrive:
 * L1 `dsh.bundle` ⟺ `cordis.patch.yml` exists and is listed in `exports`
 * L2 the `name` of every `insert` row in `cordis.patch.yml` == this package's name
 * L3 `files` covers `main` and `cordis.patch.yml`
 * L4 `@deepseek-ai/cordis` and `@deepseek-ai/dsh-*` appear as a peer + dev pair and never in dependencies
 * L5 every `@deepseek-ai/*` in `dependencies` is inside `DEPENDENCY_ALLOWLIST`
 * L6 the README has the three sections: install / configure / security
 */
export const rules: Rule[] = []
