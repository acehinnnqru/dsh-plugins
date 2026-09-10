# dsh-plugins

DeepSeek Harness 的本地插件仓库。自用，不发布。

## 环境

Node 22 由仓库的 `flake.nix` 提供，通过 direnv 进入：

```sh
direnv allow        # 首次；没装 direnv 就用 nix develop
```

`.envrc` 不入库，新克隆需要自己建，内容一行：`use flake .`

## 文档

- **[DESIGN.md](./DESIGN.md)** —— 设计说明与依据（为什么这么做）
- **[docs/specs/](./docs/specs/README.md)** —— 拆好的实施清单（做什么、怎么算做完）
- **[docs/research/](./docs/research/)** —— 调研底稿，逐条带出处

从 [docs/specs/0001-repo-skeleton.md](./docs/specs/0001-repo-skeleton.md) 开始。
