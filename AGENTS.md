# AGENTS.md

给在这个仓库里干活的模型看的。**先读这一页再动手。**

## 第一条：只用仓库自己的工具链

这个仓库的 `node` 和 `pnpm` **只来自 `flake.nix` 的 devshell**。外层 shell 里可能有
别的仓库（例如 DSH checkout）留下的环境，那里的 `node` / `pnpm` 是别人的，不要用。

```sh
direnv exec . pnpm <script>    # 每条命令都这么跑
```

- 首次进入需要 `direnv allow`；没装 direnv 就用 `nix develop` 起一个 shell，在里面直接跑 `pnpm`。
- 已经 `direnv allow` 过、并且**当前 shell 就在本仓库里**，才可以直接 `pnpm …`。
  不确定就一律 `direnv exec .` —— 它的开销可以忽略。
- **不要在仓库外面找 node / pnpm。** 不要用 `npx`、不要用 `~/Library/pnpm` 里
  自管理装的那份、不要用 DSH checkout 的 `node_modules/.bin`。

## 硬规则

1. **验收命令必须真跑。** 不要写"应该可以"。跑一次，把真实输出贴出来。
2. **一次只做一个 spec。** 做完、验收通过，再开下一个。
   顺序见 [`docs/specs/README.md`](./docs/specs/README.md)。
3. **不要调用 `dsh`。** 它只在维护者环境里可用，且需要 DSH checkout + nix devshell。
   任何脚本都不许调它——"装进 profile 启动"是人工清单，不是自动化。
4. **不要往仓库里加 profile 目录。** `dsh plugin --profile <name>` 操作的是
   `$DSH_HOME/profiles/<name>`，不在本仓库。
5. **不要重建 `flake.nix` / `flake.lock`，不要提交 `.envrc`。** 前者锁着工具链，
   后者是个人所有（已被全局 gitignore 覆盖）。
6. **依赖版本写精确值，不用 caret。** DSH 每个版本都是预发布，`^0.1.5-rc.1`
   实际上不匹配 `0.1.6-rc.1`，caret 是伪装成范围的单点锁定。见 DESIGN.md §3.4。
7. **依赖分段看「身份是否需要共享」，不是看包名。**
   - 需要唯一（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-*`）→ `peerDependencies` + `devDependencies`，永不进 `dependencies`
   - 不需要（`schemastery`、`zod`）→ `dependencies`
   `pnpm verify:compat` 和 `plugin-lint` 会拦违规。
8. **改完 `package.json` 记得让锁文件跟上**（跑一次 `pnpm install`）。本仓库锁文件**入库**
   （`pnpm-lock.yaml` 在版本控制里），改完依赖不更新它，别人装出来的树就和你不一样。
9. **测试放各包的 `tests/`，用 `*.spec.ts`，不要和源码放一起。**
10. **版本常量只有一处**：`tooling/dsh-compat/src/index.ts`。升级 DSH 只改它，再同步各插件。

## 这个仓库的形状

```
flake.nix            工具链（node 22 + pnpm），不重建
plugins/<name>/      每个目录 = 一个可安装插件（唯一声明 dsh.bundle 的地方）
packages/<lib>/      内部共享库，构建期内联，永不单独安装
tooling/<tool>/      构建与校验工具（dsh-compat 版本常量、plugin-lint）
scripts/             verify / verify:compat / plugin-lint
docs/specs/          实施清单（做什么、怎么算做完）
docs/research/       调研底稿，逐条带出处
```

## 文档的读法

| 想知道 | 读 |
|---|---|
| **为什么**这么设计 | [`DESIGN.md`](./DESIGN.md) |
| **做什么**、怎么算做完 | [`docs/specs/`](./docs/specs/README.md) |
| 上游契约的原始出处 | [`docs/research/`](./docs/research/) |
| 已落地的偏差与实测结论 | 各 spec 末尾的「实施记录」 |

**实现和 spec 冲突时：以能跑通的为准，然后回头改 spec**，把偏差和原因写进
「实施记录」。不要留一份和代码不符的 spec。
