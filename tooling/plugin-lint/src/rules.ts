import type { Rule } from './types.ts'

/**
 * 清单规则表。0001 只搭骨架，规则在 0002 里写：
 * L1 `dsh.bundle` ⟺ `cordis.patch.yml` 存在且在 `exports` 里
 * L2 `cordis.patch.yml` 里 `insert` 行的 `name` == 本包名
 * L3 `files` 覆盖 `main`、`cordis.patch.yml`
 * L4 `@deepseek-ai/cordis` 和 `@deepseek-ai/dsh-*` 在 peer + dev 成对出现，且不在 dependencies
 * L5 `dependencies` 里的 `@deepseek-ai/*` 在 `DEPENDENCY_ALLOWLIST` 内
 * L6 README 含「安装 / 配置 / 安全」三节
 */
export const rules: Rule[] = []
