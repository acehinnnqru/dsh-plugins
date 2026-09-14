# dsh-plugins

A local plugin repo for DeepSeek Harness. For personal use, nothing is published.

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
tooling/<tool>/      build and validation tools (dsh-compat version constants, plugin-lint)
scripts/             verify / verify:compat
```

There is no profile directory in the repo, and no script calls `dsh`.

## Docs

- **[DESIGN.md](./DESIGN.md)** — the design and the reasoning behind it (why it is this way)
- **[docs/research/](./docs/research/)** — research notes, every claim with its source
