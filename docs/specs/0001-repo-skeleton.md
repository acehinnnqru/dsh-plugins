# 0001 — 仓库骨架

> **前置**：仓库已有 `flake.nix` + `flake.lock`（commit `04ab7b5`），Node 22 由 nix + direnv 提供。
> 第一次进来先跑 `direnv allow`；不装 direnv 就用 `nix develop`。
> **别重建 flake**，也别把 `.envrc` 提交进去——它被全局 gitignore 覆盖，是有意保持个人化的。
> 新克隆的人需要自己写一个 `.envrc`，内容就一行：`use flake .`

## 目标

仓库能装依赖、能类型检查、能跑测试、能 lint。还没有任何插件。

## 做完的标志

```sh
pnpm install
pnpm verify        # 输出全绿，退出码 0
pnpm verify:compat # 输出当前锁定的 DSH 版本
```

## 做什么

### 1. 根 `package.json`

```json
{
  "name": "dsh-plugins-root",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.7.0",
  "engines": { "node": "^22.19.0 || >=24.0.0" },
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "tsc -b tsconfig.json",
    "lint": "oxlint plugins packages tooling scripts",
    "test": "vitest run",
    "plugin-lint": "tsx scripts/plugin-lint.ts",
    "verify": "tsx scripts/verify.ts",
    "verify:compat": "tsx scripts/verify-compat.ts"
  },
  "devDependencies": {
    "@types/node": "^22.20.0",
    "oxlint": "1.76.0",
    "tsdown": "^0.22.2",
    "tsx": "^4.22.4",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8"
  }
}
```

### 2. `pnpm-workspace.yaml`

```yaml
packages:
  - 'plugins/*'
  - 'packages/*'
  - 'tooling/*'
```

**注意**：不要把任何 profile 目录加进来。`dsh plugin --profile <name>` 操作的是 `$DSH_HOME/profiles/<name>`，不在仓库里。

### 3. TypeScript 配置

`tsconfig.base.json`：

```jsonc
{
  "compilerOptions": {
    "target": "es2024",
    "module": "esnext",
    "moduleResolution": "bundler",
    "composite": true,
    "incremental": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": ["node"]
  }
}
```

`tsconfig.json`（solution 文件，只放 references）：

```jsonc
{
  "extends": "./tsconfig.base.json",
  "files": [],
  "references": []
}
```

`references` 每加一个包补一条，指向该包的目录。

### 4. 构建

根 `tsdown.config.ts`：

```ts
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
```

`dts: false` 是对的：声明文件由 `tsc` 产出。

每个包的构建脚本统一是：

```json
"scripts": { "build": "tsc -b tsconfig.json && tsdown" }
```

### 5. `tooling/dsh-compat`

存版本常量，全仓库唯一的版本来源。

`tooling/dsh-compat/package.json`：

```json
{
  "name": "dsh-compat",
  "private": true,
  "type": "module",
  "main": "lib/types/index.js",
  "types": "lib/types/index.d.ts",
  "scripts": { "build": "tsc -b tsconfig.json && tsdown" }
}
```

`tooling/dsh-compat/src/index.ts`：

```ts
/** 本仓库针对的 DSH 版本。升级 DSH 时只改这里。 */
export const DSH_VERSION = '0.1.5-rc.1'
/** 身份必须共享的包：走 peerDependencies + devDependencies。 */
export const PEER_PACKAGES = ['@deepseek-ai/cordis'] as const
/** 允许出现在 dependencies 的 @deepseek-ai 包。 */
export const DEPENDENCY_ALLOWLIST = ['@deepseek-ai/schemastery'] as const
```

> `@deepseek-ai/cordis` 的版本和 dsh 版本线是分开的（当前 `4.0.2`），所以它单独一个常量更清楚。

### 6. `scripts/verify.ts`

顺序跑，第一个失败就停：

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm plugin-lint`
4. `pnpm test`

输出每一步的名字和耗时，最后打印一行总结果。

`scripts/plugin-lint.ts` 这一版先做成空壳（读 `plugins/*/package.json`，没有任何包就直接通过）。真正的规则在 0002 里写。

### 7. `scripts/verify-compat.ts`

1. 读 `tooling/dsh-compat` 的常量。
2. 检查每个 `plugins/*/package.json` 里 `@deepseek-ai/*` 的版本与常量一致，不一致就列出文件并失败。
3. 打印当前锁定的 DSH 版本。

现在没有插件，所以只会打印版本。

### 8. `vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['{plugins,packages,tooling}/*/tests/**/*.spec.ts'],
    environment: 'node',
  },
})
```

测试放各包的 `tests/` 目录，用 `*.spec.ts`。不要和源码放一起。

### 9. `.oxlintrc.json`

起步用最小配置即可：

```json
{
  "options": { "typeAware": true, "reportUnusedDisableDirectives": "warn" },
  "categories": { "correctness": "error" },
  "ignorePatterns": ["**/lib/**", "**/node_modules/**"]
}
```

### 10. `.gitignore`

```
node_modules/
lib/
*.tsbuildinfo
.direnv/
*.tgz
```

`flake.nix` 和 `flake.lock` **要提交**——它们锁定了工具链。`.envrc` 不提交（已被全局 gitignore 覆盖）。

## 不做

- 不建任何插件（0002）
- 不写打包自检（0003）
- 不写客户端构建 preset（0004）
- 不接远端 CI——验证全在本地跑
- 不装 `dsh`：它只有维护者能跑，脚本一律不调用它

## 验收

```sh
pnpm install
pnpm verify
```

两条都退出码 0。
