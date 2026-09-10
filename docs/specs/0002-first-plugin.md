# 0002 — 第一个插件 + 清单校验

## 目标

跑通一个插件的完整生命周期：写代码 → 构建 → 有单测 → 清单和 patch 层都不出错。

## 做完的标志

```sh
pnpm --filter dsh-plugin-now build
ls plugins/now/lib/index.js          # 存在
pnpm verify                          # 全绿，含 plugin-lint
pnpm --filter dsh-plugin-now exec vitest run tests   # 单测过
```

还要能证明 lint **真的会拦人**：`tooling/plugin-lint/tests/` 里有一组坏清单的 fixture，每个都断言会被报错。

## 做什么

### 1. 建插件目录

```
plugins/now/
├── package.json
├── cordis.patch.yml
├── tsconfig.json
├── README.md
├── src/index.ts
└── tests/now.spec.ts
```

> 这个 `now` 插件只是个探路者：注册一个返回当前时间的工具，顺便用上 `Config`。
> 它同时充当后续插件的模板。你以后有了真插件，照着换掉即可。

`plugins/now/package.json`：

```json
{
  "name": "dsh-plugin-now",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "给 harness 加一个查询当前时间的工具",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "cordis.patch.yml", "lib/types/**/*.d.ts"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "scripts": { "build": "tsc -b tsconfig.json && tsdown", "watch": "tsdown --watch" },
  "peerDependencies": { "@deepseek-ai/cordis": "4.0.2" },
  "devDependencies": {
    "@deepseek-ai/cordis": "4.0.2",
    "@deepseek-ai/dsh-tools": "0.1.5-rc.1"
  },
  "dependencies": { "@deepseek-ai/schemastery": "3.18.2" }
}
```

几个必须理解的约定：

- **`peerDependencies` + `devDependencies` 成对出现**（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-*`）。这类包的运行时身份必须全局唯一，不能随插件装第二份。
- **可重复的纯库放 `dependencies`**（`schemastery`）。多一份无害。
- **`files` 必须列全运行时产物**：少一个，装进 profile 后就缺文件。
- **`dsh.bundle.patch` 指向本包的 patch 文件**，这是"能被安装成一层配置"的声明。

`plugins/now/cordis.patch.yml`：

```yaml
# 本包贡献的 profile 层。
- insert:
    - id: now
      name: 'dsh-plugin-now'
      config:
        timeZone: 'Asia/Shanghai'
```

行里的 `name` 写**包名**，不是路径。

#### patch 文件的全部语义（只有两种操作）

写 patch 前必须知道这四条，否则会出现"改了但不生效"这种最难查的失败：

| 操作 | 写法 | 语义 |
|---|---|---|
| **插入** | `- insert: [rows]` | 追加到根列表。若该 patch 顶层带 `id:`，则插入到那个 **group 行**里 |
| **按 id 覆盖** | `- id: <row-id>` + 任意键 | 顶层带 `id`、没有 `insert` 就走覆盖分支，`target[key] = value` |

四条规则：

1. **没有删除操作。** 要中性化一行只能用 `disabled: true`。上游是刻意这么设计的——行被删掉后，将来有人重排组合会让它悄悄复活。
2. **覆盖 `config` 是整对象替换，不深合并。** 要改一个配置项，必须把该行需要的键全部重述。
3. **覆盖里的 `name` 是断言，不是改名。** 与目标行不一致会告警并跳过。
4. **未匹配到目标的 patch 只是告警 + 跳过**，格式非法的文件才硬失败。所以打错行 id 不会立刻炸，只是静默不生效——0003 的 `verify:pack` 就是为抓这个。

`plugins/now/tsconfig.json`：

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"]
}
```

别忘了把 `plugins/now` 加进根 `tsconfig.json` 的 `references`。

### 2. 插件代码

`plugins/now/src/index.ts`：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'now'
export const inject = ['tools']

export interface Config {
  /** IANA 时区名，例如 Asia/Shanghai。 */
  timeZone: string
}

export const Config: z<Config> = z.object({
  timeZone: z.string().default('UTC'),
})

export function apply(ctx: Context, config: Config) {
  ctx.tools.register(defineTool({
    name: 'now',
    description: '返回当前时间。',
    parameters: {
      format: {
        type: 'string',
        description: 'iso 或 human',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      const at = new Date()
      if (args.format === 'human') {
        return at.toLocaleString('en-GB', { timeZone: config.timeZone })
      }
      return at.toISOString()
    },
  }))
}
```

工具的完整契约（参数校验、`exec.signal`、返回值规范）以上游为准：
`docs/cookbook/adding-a-tool.md`。

### 3. 单测

`plugins/now/tests/now.spec.ts`：用一个假的 ctx 调 `apply`，拿到注册进去的工具定义，直接调它的 `execute` 断言返回值。

至少覆盖：

- 默认配置下 `format` 缺省返回 ISO 字符串
- `format: 'human'` 走时区分支
- `Config` 的默认值生效

### 4. `tooling/plugin-lint`

这一版实现 5 条规则。每条都要有"坏 fixture 会报错"的测试。

| 规则 | 检查什么 | 报错信息要说明 |
|---|---|---|
| L1 | 声明了 `dsh.bundle` ⟺ `cordis.patch.yml` 存在且在 `exports` 里 | 装了也不会激活任何层 |
| L2 | `cordis.patch.yml` 里 `insert` 行的 `name` == 本包名 | 装进 profile 后解析不到 |
| L3 | `files` 覆盖 `main`、`cordis.patch.yml` | 打包后缺文件 |
| L4 | `@deepseek-ai/cordis` 和 `@deepseek-ai/dsh-*` 在 `peerDependencies` 与 `devDependencies` 里成对出现，且不在 `dependencies` | 会出现两份运行时实例 |
| L5 | `dependencies` 里的 `@deepseek-ai/*` 在 `DEPENDENCY_ALLOWLIST` 内 | 需要显式确认它是可重复的纯库 |
| L6 | README 含「安装 / 配置 / 安全」三节 | 以后自己会忘了怎么装 |

接口：`lintPlugin(dir): Finding[]`，`scripts/plugin-lint.ts` 遍历 `plugins/*` 汇总输出并在有 finding 时退出码 1。

### 5. README

`plugins/now/README.md` 三节：

```markdown
## 它做什么
## 装进 profile
（`dsh plugin --profile dev add ./plugins/now`）
## 配置与安全
（配置项表；说明它读什么、写什么、有无网络请求）
```

## 不做

- 不装进 profile、不启动 dsh（0003）
- 不做客户端半边（0004、0005）
- 不写生成器（0006）——先手工建一遍，才知道该生成什么

## 验收

```sh
pnpm --filter dsh-plugin-now build
pnpm verify
pnpm --filter dsh-plugin-now exec vitest run tests
```

三条都退出码 0。另外随手把 `plugins/now/cordis.patch.yml` 里的 `name` 改错，确认 `pnpm plugin-lint` 会报错——**验证 lint 真的在工作**，然后改回来。
