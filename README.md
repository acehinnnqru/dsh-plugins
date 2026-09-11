# dsh-plugins

DeepSeek Harness 的本地插件仓库。自用，不发布。

## 环境

Node 22 由仓库的 `flake.nix` 提供，通过 direnv 进入：

```sh
direnv allow        # 首次；没装 direnv 就用 nix develop
```

`.envrc` 不入库，新克隆需要自己建，内容一行：`use flake .`

## 装依赖与验证

命令都走仓库自己的 devshell：

```sh
direnv exec . pnpm install
direnv exec . pnpm verify
```

已经 `direnv allow` 且当前 shell 就在本仓库里，可以直接 `pnpm …`。

给模型看的规矩在 [`AGENTS.md`](./AGENTS.md)。

版本常量只有一处：`tooling/dsh-compat/src/index.ts`。升级 DSH 时只改它，再同步各插件。

## 目录

```
plugins/<name>/     每个目录 = 一个可安装插件（唯一声明 dsh.bundle 的地方）
packages/<lib>/     内部共享库，构建期内联，永不单独安装
tooling/<tool>/     构建与校验工具（dsh-compat 版本常量、plugin-lint）
scripts/            verify / verify:compat
docs/specs/         实施清单
```

仓库里没有 profile 目录，任何脚本都不调用 `dsh`。

## 文档

- **[DESIGN.md](./DESIGN.md)** —— 设计说明与依据（为什么这么做）
- **[docs/specs/](./docs/specs/README.md)** —— 拆好的实施清单（做什么、怎么算做完）
- **[docs/research/](./docs/research/)** —— 调研底稿，逐条带出处

从 [docs/specs/0001-repo-skeleton.md](./docs/specs/0001-repo-skeleton.md) 开始。
