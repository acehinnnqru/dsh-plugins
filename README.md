# dsh-plugins

A local plugin repo for DeepSeek Harness. For personal use; nothing is published to a registry.

## Environment

Node 22 comes from the repo's `flake.nix`, entered through direnv:

```sh
direnv allow        # first time only; without direnv, use nix develop
```

`.envrc` is not tracked — a fresh clone creates its own, with the single line `use flake .`

## Installing dependencies and verifying

Every command goes through the repo's own devshell:

```sh
direnv exec . pnpm install
direnv exec . pnpm verify
```

Once `direnv allow` has been run and the current shell is inside this repo, `pnpm …` works directly.

The rules for models live in [`AGENTS.md`](./AGENTS.md).

The version constant has exactly one home: `tooling/dsh-compat/src/index.ts`. Upgrading DSH means
editing it there, then syncing every plugin.

## Layout

```
plugins/<name>/      every directory = one installable plugin (the only place that declares dsh.bundle)
packages/<lib>/      internal shared libraries, inlined at build time, never installed on their own
tooling/<tool>/      build and validation tools (dsh-compat version constants, plugin-lint, market-index)
scripts/             verify / verify:compat / market-index
index.json    the format-1 index the DSH Discover tab reads (generated, then committed)
```

There is no profile directory in the repo, and no script calls `dsh`.

## Plugin market

The experimental DSH plugin-market bundle can browse and install these plugins over Git. Generate
the index after a push, check it, and point Discover at it:

```sh
direnv exec . pnpm market:index
direnv exec . pnpm verify:market
```

[`docs/market.md`](./docs/market.md) covers hosting (this repo is private, so the raw GitHub URL is
not enough), the build approval a Git install needs, and the update loop.

## Docs

- **[DESIGN.md](./DESIGN.md)** — the design and the reasoning behind it (why it is this way)
- **[docs/market.md](./docs/market.md)** — using the repo as a plugin market index
- **[docs/research/](./docs/research/)** — research notes, every claim with its source
