# dsh-plugins

A local plugin repo for DeepSeek Harness. For personal use; nothing is published to a registry.

## Installing dependencies and verifying

```sh
pnpm install
pnpm verify
```

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
pnpm market:index
pnpm verify:market
```

[`docs/market.md`](./docs/market.md) covers hosting (this repo is private, so the raw GitHub URL is
not enough), the build approval a Git install needs, and the update loop.

## Docs

- **[DESIGN.md](./DESIGN.md)** — the design and the reasoning behind it (why it is this way)
- **[docs/market.md](./docs/market.md)** — using the repo as a plugin market index
- **[docs/research/](./docs/research/)** — research notes, every claim with its source
