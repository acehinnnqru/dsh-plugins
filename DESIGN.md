# dsh-plugins 设计说明

> **这份文档只回答「为什么」。** 做什么、怎么配、怎么验收，在 [`docs/specs/`](./docs/specs/README.md)。
> 逐条出处见 §7；调研底稿（含代码片段与文件路径）在 [`docs/research/`](./docs/research/)。

---

## 1. 范围

**自用。不发布到任何 registry。**

要达成的：

- 一个仓库放多个插件，各自独立演进。
- 同时支持两种插件：只有 host 半边的，和 host + 浏览器半边的。
- 改一行代码，能在真实的 DSH 里看到效果，秒级。
- 每个插件在**打包成 tarball 后**仍然是完整可用的——这是能自动化的最后一道关。

不做的：

- 不 fork DSH，不分发 DSH。
- 不发布到 registry（将来要做的话，§6 记了路径）。
- 不追求同时支持多个 DSH 大版本。
- **不自动化任何需要 `dsh` 的步骤。** `dsh` 只在维护者的环境里可用（DSH checkout + nix devshell + npx），所以"装进 profile 并启动"是手动清单，不是脚本。

---

## 2. 约束：DSH 插件机制强加的规则

下面每条都核实过。方案必须服从它们，没有商量余地。出处见 §7。

### 2.1 插件怎么组织、怎么装

| 事实 |
|---|
| 插件 = 一个导出 `apply` 的模块，可带 `name` / `inject` / `Config`。函数、对象、类三种形态都行 |
| 分发单元 = npm 包 + **bundle 清单**（`dsh.bundle.patch` 指向自己的 `cordis.patch.yml`）。用户装的是包，不是源码目录 |
| 没有 `dsh.bundle` 声明的包也能装，但只当普通依赖，**不激活任何配置层** |
| profile（`$DSH_HOME/profiles/<name>`）决定装什么。层序：base → 各 bundle 按序 → profile 自己的 patch → home 级 patch → `--patch` overlay |
| 后一层按行覆盖前一层。**覆盖 `config` 是整对象替换，不深合并** |
| patch 只有两种操作：`insert` 和「按 id 覆盖」。**没有删除**，中性化只能用 `disabled: true` |
| patch 行用**包名**引用插件，不是路径 |
| 未匹配到目标的 patch 只告警跳过；格式非法的文件才硬失败 |
| 插件跑在宿主进程里，**拥有宿主完整权限，没有沙箱**。写插件等于写宿主代码 |

### 2.2 浏览器半边

| 事实 |
|---|
| 声明 `dsh.client`（`platform: 'web'`）+ 导出 `exports["./client"]`，才进入 Web 客户端模块表 |
| 产物是**经典 CJS 脚本**，用 `<script src>` 加载——**ESM 语法直接报错** |
| 它必须喊 `window.__ModuleLoader__.load({ id, factory })` 把工厂注册进去 |
| 能 `require()` 的只有 9 个基线模块（react 家族、cordis、client-store、ui-slots、ui-primitives、ui-dockkit）+ 自己在 `dsh.client.external` 声明的。**其余全部内联** |
| 构建期有纯度闸门：其他 `@deepseek-ai/*` 的**值导入**直接构建失败。跨插件协作只能走 Cordis 服务或 slots |
| **浏览器端的模块图只由「正在运行的 host 行」组成**——纯 UI 包也必须有个能加载的 host 半边 |
| `dsh.client.inject` 只是信息，**不决定加载顺序**；顺序由 Cordis 服务等待决定 |
| 服务端提供的是构建产物 `lib/client.js`，不是源码。改完必须重新构建 |

### 2.3 依赖解析

| 事实 |
|---|
| bundle 名先从 dsh 安装目录解析，再从 profile 解析。patch 行里的裸包名沿 profile 目录上溯，到达 dsh 维护的 `$DSH_HOME/profiles/node_modules` fallback |
| **profile 初始化时写入 `nodeLinker: hoisted` + `autoInstallPeers: false`**，目的就是让树外插件与安装实例共享同一个 cordis 实例 |
| host 半边打包时，production 依赖保持 import，其余内联 |
| 浏览器半边打包时，基线模块保持 external，其余内联 |
| `files` 必须覆盖每个相对运行时 import 和产出资源 |

### 2.4 生态现状（实测）

| 事实 |
|---|
| DSH 当前版本线是 `next` = `0.1.5-rc.1`。**`latest` 不可信**：`@deepseek-ai/dsh` 的 `latest` 是这个版本，但 `@deepseek-ai/dsh-base` 的 `latest` 还停在 `0.0.1-rc.1` |
| `@deepseek-ai/cordis` 独立版本线，当前 `4.0.2`；`@deepseek-ai/schemastery` `3.18.2` |
| 测试支撑包**已公开发布**：`dsh-loader-smoke`、`dsh-client-test-runtime`、`dsh-agent-loop-testkit`、`dsh-llm-mock-server`、`dsh-llm-replay`、`dsh-session-snapshot` |
| **客户端构建 preset 没有发布。** `packages/client/` 下连 `package.json` 都没有 |
| **上游没有任何插件脚手架。** 没有 `create-dsh-plugin`，CLI 只有 `web` 和 `plugin` 两个子命令 |
| 上游没有为树外插件的清单提供任何校验——写错依赖段不会有人提醒你 |
| 工具链：Node 22 由仓库的 `flake.nix` + direnv 提供（与 DSH 同一个 devshells 输入）；pnpm 走仓库自己的 devshell，命令一律 `direnv exec . pnpm …` |

---

## 3. 关键取舍

### 3.1 一个插件 = 一个目录 = 一个 npm 包 = 一个 bundle

`plugins/<name>/` 里的东西不跨目录共享。理由：包是否声明 `dsh.bundle` 决定了它在 profile 里是"一层配置"还是"一个普通依赖"——这条语义很重要，混放就看不出区别了。

所以仓库里同时有 `packages/`（内部共享库，构建期内联进插件，永不单独安装）和 `tooling/`（构建与校验工具）。它们都 `private: true`，都不声明 `dsh.bundle`。

### 3.2 客户端构建 preset 必须自己写（本方案的头号工程内容）

DSH 官方的客户端构建脚本在 `packages/client/tsdown.client.ts`，**没有发布**，还依赖几个仓库内文件。任何树外 UI 插件都得自己复刻一份等价物。

这是唯一需要长期跟上游对齐的东西，所以要配一致性测试：构建一个 fixture → 在 jsdom 里搭个假的 `__ModuleLoader__` → 真的把它加载起来。**上游改了契约，测试会红，而不是等到浏览器里白屏。**

### 3.3 依赖按「身份是否需要共享」分段

判据不是"是不是 `@deepseek-ai/` 开头"，而是**这个包的运行时身份是否需要全局唯一**：

- **需要**（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-*`）→ `peerDependencies` + `devDependencies`，永不进 `dependencies`、永不打包内联。否则会出现两份 Cordis 实例，DI 直接错乱。
- **不需要**（`schemastery`、`zod`）→ `dependencies`。多一份无害。

这套策略成立是因为上游 profile 已经设了 `autoInstallPeers: false`（§2.3），peer 不会被自动装成第二份。上游自己发布的包也是这么分的。

### 3.4 版本锁精确值，不用 caret

`^0.1.5-rc.1` 看起来像"兼容 0.1.x"，其实**不匹配 `0.1.6-rc.1`**：semver 只在比较符自带同一 `[major,minor,patch]` 元组的预发布标识时，才允许预发布版本参与匹配。DSH 每个版本都是预发布，所以 caret 实际退化成了单点锁定，却伪装成兼容范围。

所以清单里写精确版本。它表达的是"针对这个版本验证过"，这是诚实的。

### 3.5 `link` 能用，但不是验收手段

`link` 装的是符号链接。Node 按真实路径解析模块，于是插件会从**本仓库**解析 `@deepseek-ai/*`，而 dsh 用的是它自己那份——两条路径不同。

这不影响 `link` 作为日常开发手段（上游文档教的本地流程就是它）。它只意味着：**验收要走 tarball**，因为 tarball 是复制进 profile，解析路径与真实安装一致。

差别只在插件是否依赖这些包的模块身份（比如 `extends Service`）。普通函数式插件两边一样。用一行 `import.meta.resolve` 探针就能确认自己属于哪种（见 0003）。

---

## 4. 仓库形状

```
plugins/<name>/     每个目录 = 一个可安装插件（唯一声明 dsh.bundle 的地方）
packages/<lib>/     内部共享库，构建期内联，永不单独安装
tooling/<tool>/     构建 preset、清单校验、版本常量
scripts/            verify / verify:pack / verify:compat
docs/specs/         实施清单
docs/research/      调研底稿
flake.nix/lock      工具链：Node 22 由 nix + direnv 提供（.envrc 个人所有，不入库）
```

**仓库里没有 profile 目录。** `dsh plugin --profile <name>` 操作的是 `$DSH_HOME/profiles/<name>`，那是维护者自己的东西。仓库只提供插件，安装命令写在 `docs/install.md` 里手动执行。

**仓库里的任何脚本都不调用 `dsh`。** 它只在维护者的环境里可用（DSH checkout + nix devshell + npx），所以能自动化的到"打包并自检"为止。

---

## 5. 风险与未验证项

| # | 风险 | 影响 | 处置 |
|---|---|---|---|
| R1 | 客户端 preset 与上游漂移，产物在浏览器里跑不起来 | 🔴 高 | 一致性测试（0004）+ 升级 DSH 时 diff 上游 preset |
| R2 | `link` 安装的解析路径与真实安装不同 | 🟡 低 | 一行探针即可定论（0003）；多数写法不受影响 |
| R3 | DSH 处于 rc，破坏性变更频繁 | 🟠 中 | 锁精确版本 + `verify:compat` 显式升级；修复只向上 |
| R4 | 依赖上游 `tsdown` 标注为 experimental 的 `workspace` 选项 | 🟡 低 | 锁定 tsdown 精确版本 |
| R5 | 源码 overlay（`.ts` 行）依赖未记载的行为组合 | 🟡 低 | 可回避——不走这条快车道也不影响任何事 |

### 待验证

| 验证 | 问题 | 做完的标志 |
|---|---|---|
| V1 | link 与 tarball 安装下，`@deepseek-ai/cordis` 的解析路径是否相同？ | 各打印一次路径比较。相同 → R2 划掉 |
| V2 | 复刻的客户端 preset 能否让产出的 `lib/client.js` 在 jsdom 里真正跑起来？ | 一致性测试通过（0004 的验收） |

---

## 6. 将来若要发布

现在不做，路径记在这里省得重新调研：

- **渠道**：npm 发布（预构建）或 `pnpm pack` 的 tarball。**git 安装不行**——monorepo 成员包没有可寻址的安装入口，而 `prepare` 必须自包含。
- **要补的**：changesets、去掉 `private`、显式设计 peer 范围（§3.4 的 caret 问题会真正咬人）。
- **可回馈生态的**：`plugin-lint` 和客户端 preset 都有实质价值——上游既没有插件脚手架，也没有发布的 preset。

---

## 7. 出处

事实来自本机 DSH checkout（`/Users/rqc/r/github.com/deepseek-ai/deepseek-harness`，版本线 `0.1.5-rc.1`）与 npm registry 实测。

两份逐条带文件路径与代码片段的调研底稿：

- [`docs/research/host-and-bundle-contract.md`](./docs/research/host-and-bundle-contract.md) — 导出契约、`Config`/`!!js`、patch 语义、安装流程、profile 布局、依赖规则、清单必填项
- [`docs/research/client-half-build-contract.md`](./docs/research/client-half-build-contract.md) — `dsh.client` 校验、产物契约、基线与纯度闸门、HMR

关键源码位置：

| 主题 | 位置 |
|---|---|
| patch 的全部语义 | `vendor/include/src/index.ts` |
| 客户端产物契约 | `packages/client/tsdown.client.ts` |
| 基线模块 | `packages/client/web/src/platform.ts` + `src/seed.ts` |
| 模块表加载 | `packages/client/modules/src/client/system.ts` |
| 浏览器图只认活着的 host 行 | `packages/client/web/src/boot.ts` |
| profile 初始化 | `packages/boot/app-boot/src/profile.ts` |
| 清单类型定义 | `packages/util/package-manifest/src/types.ts` |
| HMR 驱动 | `packages/client/hmr/src/index.ts` |
| 测试支撑包用法 | `packages/test-support/loader-smoke/README.md` |

**本机工具链**：Node `v22.22.3` 来自仓库的 nix devshell（`/nix/store/...-nodejs-22.22.3`），pnpm `11.7.0` 来自 pnpm 的版本自管理。两者都不是系统安装。
