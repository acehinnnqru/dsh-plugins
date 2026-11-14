# dsh-plugins design notes

> **This document answers "why" only.** Sources, item by item, are in §7, and the research
> notes (with code snippets and file paths) are in [`docs/research/`](./docs/research/).

---

## 1. Scope

**Personal use. Nothing is published to any registry.**

What it has to achieve:

- Several plugins in one repo, each evolving independently.
- Support both plugin kinds at once: host half only, and host + browser half.
- Change one line of code and see the effect in a real DSH within seconds.
- Every plugin stays fully usable **after it is packed into a tarball** — that is the last gate that can be automated.

What it will not do:

- No forking DSH, no distributing DSH.
- No publishing to a registry (if that ever happens, §6 records the path).
- No ambition to support several DSH major versions at once.
- **No automating any step that needs `dsh`.** `dsh` exists only in the maintainer's environment (DSH checkout + npx), so "install it into a profile and start it" is a manual checklist, not a script.

---

## 2. Constraints: rules the DSH plugin mechanism imposes

Every item below has been verified. The design has to obey them; there is nothing to negotiate. Sources in §7.

### 2.1 How plugins are organized and installed

| Fact |
|---|
| A plugin = a module exporting `apply`, optionally carrying `name` / `inject` / `Config`. Function, object and class forms all work |
| The distribution unit = an npm package + a **bundle manifest** (`dsh.bundle.patch` pointing at its own `cordis.patch.yml`). What a user installs is the package, not the source directory |
| A package with no `dsh.bundle` declaration can still be installed, but only as an ordinary dependency — **it activates no config layer** |
| The profile (`$DSH_HOME/profiles/<name>`) decides what is installed. Layer order: base → each bundle in order → the profile's own patch → the home-level patch → the `--patch` overlay |
| Each later layer overrides the previous one line by line. **Overriding `config` replaces the whole object; it does not deep-merge** |
| A patch has only two operations: `insert` and "override by id". **There is no delete**; the only way to neutralize something is `disabled: true` |
| Patch lines reference plugins by **package name**, not by path |
| A patch that matches no target only warns and is skipped; only a syntactically invalid file hard-fails |
| Plugins run inside the host process and **hold the host's full privileges — there is no sandbox**. Writing a plugin is writing host code |

### 2.2 The browser half

| Fact |
|---|
| Only a package that declares `dsh.client` (`platform: 'web'`) **and** exports `exports["./client"]` enters the Web client module table |
| The artifact is a **classic CJS script** loaded with `<script src>` — **ESM syntax fails outright** |
| It must call `window.__ModuleLoader__.load({ id, factory })` to register its factory |
| Only 11 baseline modules can be `require()`d (the react family, cordis, zod, `@tanstack/react-virtual`, client-store, ui-slots, ui-primitives, ui-dockkit) plus whatever you declare in `dsh.client.external`. **Everything else is inlined** |
| There is a build-time purity gate: a **value import** from any other `@deepseek-ai/*` fails the build. Cross-plugin collaboration can only go through Cordis services or slots |
| **The browser-side module graph is made only of "live host rows"** — a pure UI package still needs a host half that loads |
| `dsh.client.inject` is informational only; **it does not decide load order**, which comes from Cordis service waiting |
| The server serves the build artifact `lib/client.js`, not the source. Any edit means rebuilding |

### 2.3 Dependency resolution

| Fact |
|---|
| Bundle names resolve from the dsh install directory first, then from the profile. Bare package names in patch lines walk up from the profile directory until they reach the `$DSH_HOME/profiles/node_modules` fallback maintained by dsh |
| **Profile initialization writes `nodeLinker: hoisted` + `autoInstallPeers: false`**, precisely so that out-of-tree plugins and the installed instance share one cordis instance |
| When packing the host half, production dependencies stay as imports and everything else is inlined |
| When packing the browser half, the baseline modules stay external and everything else is inlined |
| `files` must cover every relative runtime import and every emitted asset |

### 2.4 The state of the ecosystem (measured)

| Fact |
|---|
| The maintainer's DSH installation runs the `rc` line, now `0.2.2-rc.3`, and this repo pins that exact release; `alpha` is `0.2.2-alpha.3`, and `next` also points at `0.2.2-rc.3`. **`latest` is not trustworthy**: on `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-client-web` it still points at `0.0.1-rc.1` |
| `@deepseek-ai/cordis` is pinned to `4.1.0` and `@deepseek-ai/schemastery` to `3.19.0` — the lines the `0.2.2-rc.3` DSH packages require (`~4.1.0`, `~3.19.0`). A DSH release bump moves them too |
| The test-support packages **are published**: `dsh-loader-smoke`, `dsh-client-test-runtime`, `dsh-agent-loop-testkit`, `dsh-llm-mock-server`, `dsh-llm-replay`, `dsh-session-snapshot` |
| **The client build preset is not published.** There is not even a `package.json` under `packages/client/` |
| **Upstream has no plugin scaffold at all.** There is no `create-dsh-plugin`; the CLI has only the `web` and `plugin` subcommands |
| Upstream does not validate an out-of-tree plugin's manifest shape, but the `0.2.2-rc.3` runtime **does** compare the plugin's declared `@deepseek-ai/dsh-*` peer requirements with its own version and refuses a mismatch; `dsh plugin allow-version` is the explicit escape hatch |
| `0.2.2-rc.3` ships the experimental plugin-market bundle and `@deepseek-ai/dsh-plugin-market-index`; the reference generator under `apps/plugin-market-generator` is not published. An index version installs from npm or a commit-pinned Git repository — never from a tarball URL |

---

## 3. Key trade-offs

### 3.1 One plugin = one directory = one npm package = one bundle

Nothing under `plugins/<name>/` is shared across directories. The reason: whether a package declares `dsh.bundle` decides whether it is "one config layer" or "an ordinary dependency" inside a profile — that semantic matters, and mixing them makes the difference invisible.

So the repo also has `packages/` (internal shared libraries, inlined into plugins at build time, never installed on their own) and `tooling/` (build and validation tools). Both are `private: true` and neither declares `dsh.bundle`.

### 3.2 The client build preset has to be written by hand (the number-one engineering item here)

DSH's official client build script is `packages/client/tsdown.client.ts`; it is **not published** and depends on several in-repo files. Any out-of-tree UI plugin has to reproduce an equivalent, so this repo has `tooling/dsh-client-preset` (one call, `clientBundle(id, libEntry)`, emits the Node half and the browser half in one run).

This is the only thing that needs long-term alignment with upstream, so it gets a consistency test: build a fixture → stand up a fake `__ModuleLoader__` in jsdom → actually load it. **If upstream changes the contract the test goes red, instead of you finding a blank page in the browser.**

Facts the implementation and its tests have settled, beyond the contract in §2.2:

- **Import the preset by source subpath** (`dsh-client-preset/src/index.ts`). tsdown *executes* a package's config file before it builds anything, so a bare import would read the preset's built `lib/index.js` — not built yet on a fresh clone, and blind to later edits.
- **A browser entry with JSX has to be `src/client/index.tsx`.** Only the `.tsx` extension lets tsc parse the angle brackets, and it is what emits `lib/types/client/index.js` — the preset's default browser entry. `src/client/index.ts` holding JSX does not compile.
- **`--watch` needs `addWatchFile` in the preset's source-map plugin.** The plugin serves the emitted modules from a `load` hook instead of letting rolldown read them, and rolldown does not watch a file it never read, so without it the loop silently stalls at the first source edit. Locked down by a conformance test that edits a fixture's source and waits for the rebuilt bundle.
- **`react` is not a dependency** — it is a frozen baseline module the shell's table answers. The types are not, so `@types/react` is a devDependency; the JSX transform needs them at build time.

`plugins/now` is the worked example of all of this: `src/client/index.tsx` registers one cell into `sidebar.footer.action`, and its `tests/client.spec.ts` executes the *built* `lib/client.js` in a plain V8 context with a fake `__ModuleLoader__` and an empty module table. Editing `src/client/` → `tsc -b --watch` republishes `lib/types/` → `tsdown --watch` rewrites `lib/client.js` → the host's own polling swaps the plugin into the running browser. No `dsh` restart, and no watcher of our own.

### 3.3 Dependencies are split by "must the identity be shared"

The test is not "does the name start with `@deepseek-ai/`" but **does this package's runtime identity have to be globally unique**:

- **Yes** (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-*`) → `peerDependencies` + `devDependencies`, never in `dependencies`, never inlined into the bundle. Otherwise you get two Cordis instances and DI breaks outright.
- **No** (`schemastery`, `zod`) → `dependencies`. A second copy is harmless.

The strategy holds because the upstream profile already sets `autoInstallPeers: false` (§2.3), so a peer is not auto-installed as a second copy. Upstream splits its own published packages the same way.

### 3.4 Pin exact versions, never carets

`^0.1.5-rc.1` looks like "compatible with 0.1.x" but **does not match `0.1.6-rc.1`**: semver lets a prerelease version participate in a match only when the comparator itself carries a prerelease identifier with the same `[major,minor,patch]` tuple. Every DSH release is a prerelease, so a caret degenerates into a single-point pin while pretending to be a compatible range.

So manifests carry exact versions. That says "verified against this version", which is the honest statement.

`dsh-client-preset` is the exception that proves the rule: it is a `private` workspace package that exists only here, so a plugin names it as `"dsh-client-preset": "file:../../tooling/dsh-client-preset"`. The more idiomatic `workspace:*` **breaks `pnpm pack`**, which is what `verify:pack` runs: pnpm resolves a workspace-protocol dependency for the packed manifest by reading it out of `node_modules`, and refuses with `ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL` for a workspace member that is not a registry install. Since the packed manifest drops `devDependencies` either way, `file:` costs nothing and keeps the acceptance command runnable.

### 3.5 `link` works, but is not an acceptance method

`link` installs a symlink. Node resolves modules by real path, so the plugin resolves `@deepseek-ai/*` from **this repo** while dsh uses its own copy — two different paths.

That does not stop `link` from being the everyday development tool (it is the local flow upstream documents). It only means **acceptance goes through a tarball**, because a tarball is copied into the profile and resolves exactly like a real install.

The difference only shows up when a plugin depends on the module identity of those packages (extending `Service`, say). Plain functional plugins behave the same either way. A one-line `import.meta.resolve` probe tells you which kind you have.

### 3.6 The market index names a commit, so `lib/` has to be built at install time

DSH's Discover tab reads a static format-1 index. The format's only sources are npm and Git; this repo publishes to neither registry, so every entry is a Git source pinned to `{ url, commit, path }`. That makes the gitignored `lib/` the central problem: a Git checkout has no build output, and the loader needs `lib/index.js`.

The fix is a `prepare` script plus the toolchain as the plugin's own devDependencies. pnpm runs `prepare` for a Git dependency after installing its dependencies, so the subdirectory builds in place; the experiment (a temporary clone, then `pnpm add git+file://…&path:/plugins/now`) produced `lib/index.js` and `lib/client.js`. pnpm 11 blocks that script until the user approves the exact `allowBuilds` key; DSH's plugin manager exposes that approval and records the commit. The cost is one approval per new commit, not per install of the same commit.

Two consequences:

- `private: true` was removed from the plugin manifests. The market's reference generator treats a private Git package as not distributable, and an index entry is a distribution claim; it is not an npm publish.
- The index is a release artifact. A commit cannot contain its own SHA, so the index lags the branch by one commit and is regenerated after a push (`pnpm market:index`), then validated (`pnpm verify:market`).

---

## 4. Repo shape

```
plugins/<name>/     every directory = one installable plugin (the only place that declares dsh.bundle)
packages/<lib>/     internal shared libraries, inlined at build time, never installed on their own
tooling/<tool>/     build preset, manifest lint, version constants, market index
tooling/market-index/  format-1 index builder + verifier
scripts/            verify / verify:pack / verify:compat / verify:platform-modules / market-index
index.json   generated index (pins commits; regenerate after a push)
docs/research/      research notes
```

**There is no profile directory in the repo.** `dsh plugin --profile <name>` operates on `$DSH_HOME/profiles/<name>`, which is the maintainer's own; the repo only ships plugins, and installing them is a manual step.

**No script in the repo calls `dsh`.** It exists only in the maintainer's environment (DSH checkout + npx), so automation stops at "pack and self-check".

---

## 5. Risks and unverified items

| # | Risk | Impact | Handling |
|---|---|---|---|
| R1 | The client preset drifts from upstream and the artifact will not run in the browser | 🔴 High | Consistency test (builds a fixture and runs the emitted `lib/client.js` in jsdom) + `verify:platform-modules` for the module baseline + diff the upstream preset when bumping DSH |
| R2 | A `link` install resolves along different paths than a real install | 🟡 Low | A one-line probe settles it; most authoring styles are unaffected |
| R3 | DSH is pre-1.0, so breaking changes are frequent | 🟠 Medium | Pin exact versions + make upgrades explicit through `verify:compat`; fixes go upstream only |
| R4 | Depends on the `workspace` option that upstream marks experimental in `tsdown` | 🟡 Low | Pin tsdown to an exact version |
| R5 | The source overlay (`.ts` rows) depends on an undocumented combination of behaviours | 🟡 Low | Avoidable — skipping that fast lane costs nothing |
| R6 | A Git install runs `prepare`, so pnpm 11 requires build-script approval and the build's devDependencies from the registry | 🟠 Medium | The plugin manager surfaces the exact `allowBuilds` key; `docs/market.md` documents the approval. A tarball install still works without it |
| R7 | The index must be fetched without credentials and without redirects; this repo is private, so GitHub raw is not an index source | 🟡 Low | Serve `index.json` from a local or public HTTP(S) endpoint; the Git source itself works over SSH |

### Still to verify

| Verification | Question | Done when |
|---|---|---|
| V1 | Do `link` and tarball installs resolve `@deepseek-ai/cordis` to the same path? | Print both paths and compare. Identical → strike R2 |
| ~~V2~~ | Does the reproduced client preset actually run the emitted `lib/client.js` in jsdom? | **Settled**: `tooling/dsh-client-preset/tests/conformance.spec.ts` builds the `hello-client` fixture and loads its bundle into a jsdom realm with a fake `__ModuleLoader__`; 9 tests pass |

---

## 6. If it is ever published

Not now; the path is recorded here so the research does not have to be redone:

- **Channel**: an npm publish (prebuilt), a `pnpm pack` tarball, or the plugin market's Git source. The Git source now works because each plugin declares a `prepare` script and its build devDependencies (§3.6); without that, a monorepo subdirectory has no build output. A market index lists only npm and Git, so a tarball is not an index source.
- **To add**: changesets and design peer ranges explicitly (the caret problem from §3.4 really bites here). `private` is already removed from the plugin manifests for the market, but an npm publish still needs the rest.
- **Could be given back to the ecosystem**: `plugin-lint` and the client preset both have real value — upstream has neither a plugin scaffold nor a published preset.

---

## 7. Sources

The facts come from the local DSH checkout (read-only) and from measurements against the npm registry. The market facts come from the installed `@deepseek-ai/dsh-plugin-market-index` 0.2.2-rc.3 validator and types, the `@deepseek-ai/dsh-plugin-market` README, and the upstream note `.agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.md`.

The three research notes, item by item with file paths and code snippets:

- [`docs/research/host-and-bundle-contract.md`](./docs/research/host-and-bundle-contract.md) — export contract, `Config`/`!!js`, patch semantics, install flow, profile layout, dependency rules, required manifest fields
- [`docs/research/client-half-build-contract.md`](./docs/research/client-half-build-contract.md) — `dsh.client` validation, artifact contract, baselines and the purity gate, HMR
- [`docs/research/client-plugin-extension-points.md`](./docs/research/client-plugin-extension-points.md) — every client-side extension point an out-of-tree plugin can use: document viewers, the slot inventory, host→browser data paths, and what is closed to plugins

Key source locations:

| Topic | Location |
|---|---|
| All patch semantics | `vendor/include/src/index.ts` |
| Client artifact contract | `packages/client/tsdown.client.ts` |
| Baseline modules | `packages/client/web/src/platform.ts` + `src/seed.ts` |
| Module table loading | `packages/client/modules/src/client/system.ts` |
| The browser graph only counts live host rows | `packages/client/web/src/boot.ts` |
| Profile initialization | `packages/boot/app-boot/src/profile.ts` |
| Manifest type definitions | `packages/util/package-manifest/src/types.ts` |
| Plugin market index format | `.agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.md`; `packages/util/plugin-market-index/src/index.ts` |
| Market reader and install rules | `packages/boot/plugin-market/README.md`; `packages/boot/plugin-manager/README.md` |
| Market index reference generator | `apps/plugin-market-generator/README.md` |
| HMR driver | `packages/client/hmr/src/index.ts` |
| How to use the test-support packages | `packages/test-support/loader-smoke/README.md` |

**Local toolchain**: Node `v22.22.3`, pnpm `11.7.0`. Neither is a system install.
