# 0003 — 打包自检与安装验收

> **前提：`dsh` 只有你能跑。** 你在 DSH checkout 里用 nix devshell + npx 执行，本仓库的任何脚本都**不假设能调用 dsh**。
>
> 所以这个 spec 分两半：
> - **能自动化的**：打包 + 自检，跑在 `pnpm verify:pack` 里。
> - **需要 dsh 的**：变成给你的命令清单，写进 `docs/install.md`，你手动跑。

## 目标

插件能打成 tarball，tarball 里该有的东西都在，装进 profile 后能活着。

## 做完的标志

```sh
pnpm verify:pack      # 自动，不碰 dsh
```

通过。然后你按 `docs/install.md` 跑一遍手动清单，确认插件真的在 dsh 里活着。

## 做什么

### 1. `scripts/verify-pack.ts`（自动部分）

对每个 `plugins/*`：

1. `pnpm pack` 到临时目录
2. 解开 tarball，逐条断言：

| 断言 | 抓什么 |
|---|---|
| `package/package.json` 存在，且 `dsh.bundle.patch` 指向的文件**确实在包里** | patch 没被 `files` 带上 |
| `main` / `exports` 指向的文件都在包里 | `files` 少写一项——这个只有装完才会暴露 |
| 声明了 `dsh.client` ⟺ `lib/client.js` 在包里 | 双半插件漏了产物 |
| `cordis.patch.yml` 是合法的 YAML 顶层数组 | 格式错会让 boot 直接失败 |
| 该文件里 `insert` 行的 `name` == 包名 | 装进 profile 后解析不到 |
| `pkg.dsh` 字段结构与 `package-manifest` 类型一致 | 手写清单写错 |

3. 清理临时目录

**这是本 spec 的核心价值**：`files` 少一项、patch 忘了带，这类问题在本地开发时完全看不出来，只有装进 profile 才炸。在打包这一步就拦住，比等你手动装完发现要早得多。

### 2. `docs/install.md`（手动清单）

写成可以直接复制粘贴的。包含四个部分：

**a. 装进 profile**

```sh
dsh plugin --profile plugins add /Users/rqc/r/github.com/acehinnnqru/dsh-plugins/plugins/now
```

**b. 不启动就验证层生效了**

```sh
dsh --profile plugins --dump-config | grep -A2 'dsh-plugin-now'
```

应该看到 `# == dsh-plugin-now` 这一层。**这一步比启日志更早定位问题**：层没生效是配置问题，层生效了但插件没加载是代码问题。

**c. 启动**

```sh
dsh --profile plugins
```

**d. 那行探针（只跑一次）**

在插件的 `apply` 里临时加：

```ts
console.log('[probe] cordis =', import.meta.resolve('@deepseek-ai/cordis'))
```

link 安装和 tarball 安装各跑一次，比较输出：

- **相同** → 两种安装等价，日常用 link（快）。
- **不同** → 日常仍可用 link，但**验收用 tarball**。差异只在插件是否依赖这些包的模块身份（比如 `extends Service`）；普通函数式插件两边一样。

结果记在 `docs/install.md` 里，然后**把那行 probe 删掉**。

### 3. 根 `package.json` 加脚本

```json
"verify:pack": "tsx scripts/verify-pack.ts"
```

`pnpm verify` 里也带上它。

## 不做

- **不把 `@deepseek-ai/dsh` 加进依赖。** 你有自己的 dsh，装第二份只会带来版本混乱。
- **不提交 profile 目录。** `dsh plugin --profile <name>` 操作的是 `$DSH_HOME/profiles/<name>`，不是仓库里的目录。仓库提供插件，profile 是你自己的东西。
- 不写"启动 dsh 并断言"的自动化脚本——那需要 dsh，而这里跑不了。

## 验收

```sh
pnpm verify:pack
```

自动部分通过。然后手动部分：

1. 按 `docs/install.md` 装一次，启动后看到插件的加载日志。
2. 故意从 `package.json` 的 `files` 里删掉 `cordis.patch.yml`，重跑 `pnpm verify:pack` —— **必须报错**（验证自检真的在工作），然后改回来。
