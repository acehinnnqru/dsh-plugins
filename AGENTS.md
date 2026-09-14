# AGENTS.md

For models working in this repo. **Read this page before you touch anything.**

## Rule one: use only this repo's own toolchain

`node` and `pnpm` here **come only from the `flake.nix` devshell**. The outer shell may
still carry another repo's environment (the DSH checkout, for instance); those
`node` / `pnpm` binaries are someone else's. Do not use them.

```sh
direnv exec . pnpm <script>    # run every command this way
```

- The first entry needs `direnv allow`; without direnv, start a shell with `nix develop` and run `pnpm` inside it.
- Only when `direnv allow` has already been run **and the current shell is inside this repo** may you run `pnpm …` directly. When in doubt, always `direnv exec .` — its overhead is negligible.
- **Do not go hunting for node / pnpm outside the repo.** No `npx`, not the self-managed copy under `~/Library/pnpm`, not the DSH checkout's `node_modules/.bin`.

## Hard rules

1. **Acceptance commands must actually run.** Never write "it should work". Run it once and paste the real output.
2. **Everything that enters git is English.** Code, comments, docs, test names, script output, commit messages — no Chinese. The single exception is user-facing copy that genuinely has to be Chinese (a plugin's Chinese UI strings, say), and even then only the copy itself is exempt. Files that never enter git — local scratch notes — are outside this rule.
3. **One change at a time.** Finish it, get it accepted, then start the next one.
4. **Do not call `dsh`.** It is only available in the maintainer's environment, and it needs the DSH checkout + nix devshell. No script may call it — "install it into a profile and start it" is a manual checklist, not automation.
5. **Do not add profile directories to the repo.** `dsh plugin --profile <name>` operates on `$DSH_HOME/profiles/<name>`, which is not in this repo.
6. **Do not rebuild `flake.nix` / `flake.lock`, and do not commit `.envrc`.** The first two pin the toolchain; the last is personal (already covered by the global gitignore).
7. **Write exact dependency versions, never carets.** Every DSH release is a prerelease and `^0.1.5-rc.1` does not actually match `0.1.6-rc.1`; a caret is a single-point pin disguised as a range. See DESIGN.md §3.4.
8. **Split dependencies by "must the identity be shared", not by package name.**
   - Must be unique (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-*`) → `peerDependencies` + `devDependencies`, never in `dependencies`
   - Need not be (`schemastery`, `zod`) → `dependencies`
   `pnpm verify:compat` and `plugin-lint` reject violations.
9. **After changing `package.json`, bring the lockfile along** (run `pnpm install` once). This repo **tracks** its lockfile (`pnpm-lock.yaml` is under version control); change a dependency without updating it and everyone else installs a different tree than you.
10. **Tests go in each package's `tests/`, named `*.spec.ts`** — never next to the source.
11. **The version constant has exactly one home**: `tooling/dsh-compat/src/index.ts`. Upgrading DSH means editing that, then syncing every plugin.

## The shape of this repo

```
flake.nix            toolchain (node 22 + pnpm), do not rebuild
plugins/<name>/      every directory = one installable plugin (the only place that declares dsh.bundle)
packages/<lib>/      internal shared libraries, inlined at build time, never installed on their own
tooling/<tool>/      build and validation tools (dsh-compat version constants, plugin-lint)
scripts/             verify / verify:compat / plugin-lint
docs/research/       research notes, every claim with its source
```

## How to read the docs

| To learn | Read |
|---|---|
| **Why** it is designed this way | [`DESIGN.md`](./DESIGN.md) |
| Where an upstream contract comes from | [`docs/research/`](./docs/research/) |

**When the docs and the code disagree, the code that runs wins — then go back and fix the doc.**
Never leave a doc that contradicts the code.
