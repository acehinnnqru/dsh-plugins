# 0006 — 插件生成器

## 目标

一条命令生成一个**立刻能构建、能通过全部检查**的新插件。

## 做完的标志

```sh
pnpm new:plugin demo
pnpm --filter dsh-plugin-demo build
ls plugins/demo/lib/index.js     # 存在
pnpm verify                      # 全绿
```

生成的东西不需要任何手工修补。

## 为什么值得做

上游**没有任何插件脚手架**——没有 `create-dsh-plugin`，没有 `plugin create`，CLI 只有 `web` 和 `plugin` 两个子命令。官方给插件作者的路子是"照着手册抄一遍"。

抄一遍要记住的东西不少（`dsh.bundle`、`exports`、`files`、peer/dev 成对、patch 行的写法、tsconfig、tsdown 配置……），漏一个的报错时机往往很晚。所以这件事值得自动化。

## 做什么

### 1. 模板

放在 `templates/plugin/`，用占位符而不是真名字：

```
templates/plugin/
├── package.json
├── cordis.patch.yml
├── tsconfig.json
├── tsdown.config.ts.tpl      # 只有 --ui 时才生成，故带后缀
├── README.md
├── src/index.ts
├── src/client/index.ts.tpl   # 同上
└── tests/plugin.spec.ts
```

占位符就用 `__NAME__`（包名去掉 `dsh-plugin-` 前缀的部分）和 `__PACKAGE__`（完整包名），纯字符串替换，不引模板引擎。

模板内容直接抄 0002 里那个 `now` 插件——**先手工做一遍，才知道该生成什么**（这也是 0002 不做生成器的原因）。

### 2. `scripts/new-plugin.ts`

```
pnpm new:plugin <name> [--ui]
```

步骤：

1. 校验 `<name>`：小写字母、数字、连字符；`plugins/<name>` 不能已存在
2. 复制 `templates/plugin/` → `plugins/<name>/`
3. 替换占位符
4. 去掉 `.tpl` 后缀；`--ui` 时保留，否则删掉这两个文件和它们相关的字段
5. 把 `plugins/<name>` 加进根 `tsconfig.json` 的 `references`
6. 打印接下来该敲什么

`--ui` 做的事：

- `package.json` 加 `exports["./client"]`、`dsh.client`、`files` 里的 `lib/client.js`
- 生成 `tsdown.config.ts`（调 `clientBundle`）
- `tsconfig.json` 加 DOM / JSX
- 保留 `src/client/index.ts`

### 3. 模板必须自己是通过的

**模板里的测试要能过。** 一个生成的插件带着一个失败的测试，比没有生成器更糟。

所以模板的 `tests/plugin.spec.ts` 至少覆盖：插件导出 `apply`，且 `apply` 在假 ctx 上调用不抛错。

### 4. 加脚本

```json
"new:plugin": "tsx scripts/new-plugin.ts"
```

## 怎么做算做对了

生成器最容易出的问题是**模板和现实脱节**：改了 lint 规则、改了构建方式，模板没跟着改，于是生成出来的东西一构建就红。

对策是让验收测试真的跑一遍生成：

`tooling/... 或 scripts/tests/new-plugin.spec.ts`：

1. 在临时目录生成一个插件
2. 对它跑 `plugin-lint`
3. 断言没有 finding

这样模板一旦腐烂，`pnpm verify` 立刻会红。

## 不做

- 不自动 `pnpm install`
- 不自动 git add / commit
- 不做交互式问答——参数就够，保持可脚本化
- 不生成 profile——`dsh plugin --profile <name>` 操作的是 `$DSH_HOME/profiles/<name>`，不在仓库里

## 验收

```sh
pnpm new:plugin demo
pnpm --filter dsh-plugin-demo build
pnpm verify
pnpm new:plugin demo-ui --ui
pnpm --filter dsh-plugin-demo-ui build
ls plugins/demo-ui/lib/client.js
pnpm verify
```

全部通过。验收完把 `demo` 和 `demo-ui` 删掉（生成器的产物是模板，不是这两个插件）。

再确认一遍"模板不会腐烂"的那条测试真的在跑：故意把模板里的 `files` 删一项，`pnpm verify` 必须红。
