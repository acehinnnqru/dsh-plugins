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
- **No automating any step that needs `dsh`.** `dsh` exists only in the maintainer's environment (DSH checkout + nix devshell + npx), so "install it into a profile and start it" is a manual checklist, not a script.

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
| Only 9 baseline modules can be `require()`d (the react family, cordis, client-store, ui-slots, ui-primitives, ui-dockkit) plus whatever you declare in `dsh.client.external`. **Everything else is inlined** |
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
| DSH's current line is `next` = `0.1.5-rc.1`. **`latest` is not trustworthy**: `@deepseek-ai/dsh`'s `latest` is that version, but `@deepseek-ai/dsh-base`'s `latest` is still `0.0.1-rc.1` |
| `@deepseek-ai/cordis` is on its own version line, currently `4.0.2`; `@deepseek-ai/schemastery` is `3.18.2` |
| The test-support packages **are published**: `dsh-loader-smoke`, `dsh-client-test-runtime`, `dsh-agent-loop-testkit`, `dsh-llm-mock-server`, `dsh-llm-replay`, `dsh-session-snapshot` |
| **The client build preset is not published.** There is not even a `package.json` under `packages/client/` |
| **Upstream has no plugin scaffold at all.** There is no `create-dsh-plugin`; the CLI has only the `web` and `plugin` subcommands |
| Upstream validates nothing about an out-of-tree plugin's manifest — declare the wrong dependency section and nobody will tell you |
| Toolchain: Node 22 comes from the repo's `flake.nix` + direnv (the same devshells input DSH uses); pnpm goes through the repo's own devshell, and every command is `direnv exec . pnpm …` |

---

## 3. Key trade-offs

### 3.1 One plugin = one directory = one npm package = one bundle

Nothing under `plugins/<name>/` is shared across directories. The reason: whether a package declares `dsh.bundle` decides whether it is "one config layer" or "an ordinary dependency" inside a profile — that semantic matters, and mixing them makes the difference invisible.

So the repo also has `packages/` (internal shared libraries, inlined into plugins at build time, never installed on their own) and `tooling/` (build and validation tools). Both are `private: true` and neither declares `dsh.bundle`.

### 3.2 The client build preset has to be written by hand (the number-one engineering item here)

DSH's official client build script is `packages/client/tsdown.client.ts`; it is **not published** and depends on several in-repo files. Any out-of-tree UI plugin has to reproduce an equivalent.

This is the only thing that needs long-term alignment with upstream, so it gets a consistency test: build a fixture → stand up a fake `__ModuleLoader__` in jsdom → actually load it. **If upstream changes the contract the test goes red, instead of you finding a blank page in the browser.**

### 3.3 Dependencies are split by "must the identity be shared"

The test is not "does the name start with `@deepseek-ai/`" but **does this package's runtime identity have to be globally unique**:

- **Yes** (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-*`) → `peerDependencies` + `devDependencies`, never in `dependencies`, never inlined into the bundle. Otherwise you get two Cordis instances and DI breaks outright.
- **No** (`schemastery`, `zod`) → `dependencies`. A second copy is harmless.

The strategy holds because the upstream profile already sets `autoInstallPeers: false` (§2.3), so a peer is not auto-installed as a second copy. Upstream splits its own published packages the same way.

### 3.4 Pin exact versions, never carets

`^0.1.5-rc.1` looks like "compatible with 0.1.x" but **does not match `0.1.6-rc.1`**: semver lets a prerelease version participate in a match only when the comparator itself carries a prerelease identifier with the same `[major,minor,patch]` tuple. Every DSH release is a prerelease, so a caret degenerates into a single-point pin while pretending to be a compatible range.

So manifests carry exact versions. That says "verified against this version", which is the honest statement.

### 3.5 `link` works, but is not an acceptance method

`link` installs a symlink. Node resolves modules by real path, so the plugin resolves `@deepseek-ai/*` from **this repo** while dsh uses its own copy — two different paths.

That does not stop `link` from being the everyday development tool (it is the local flow upstream documents). It only means **acceptance goes through a tarball**, because a tarball is copied into the profile and resolves exactly like a real install.

The difference only shows up when a plugin depends on the module identity of those packages (extending `Service`, say). Plain functional plugins behave the same either way. A one-line `import.meta.resolve` probe tells you which kind you have.

---

## 4. Repo shape

```
plugins/<name>/     every directory = one installable plugin (the only place that declares dsh.bundle)
packages/<lib>/     internal shared libraries, inlined at build time, never installed on their own
tooling/<tool>/     build preset, manifest lint, version constants
scripts/            verify / verify:pack / verify:compat
docs/research/      research notes
flake.nix/lock      toolchain: Node 22 from nix + direnv (.envrc is personal, not tracked)
```

**There is no profile directory in the repo.** `dsh plugin --profile <name>` operates on `$DSH_HOME/profiles/<name>`, which is the maintainer's own; the repo only ships plugins, and installing them is a manual step.

**No script in the repo calls `dsh`.** It exists only in the maintainer's environment (DSH checkout + nix devshell + npx), so automation stops at "pack and self-check".

---

## 5. Risks and unverified items

| # | Risk | Impact | Handling |
|---|---|---|---|
| R1 | The client preset drifts from upstream and the artifact will not run in the browser | 🔴 High | Consistency test + diff the upstream preset when bumping DSH |
| R2 | A `link` install resolves along different paths than a real install | 🟡 Low | A one-line probe settles it; most authoring styles are unaffected |
| R3 | DSH is at rc, so breaking changes are frequent | 🟠 Medium | Pin exact versions + make upgrades explicit through `verify:compat`; fixes go upstream only |
| R4 | Depends on the `workspace` option that upstream marks experimental in `tsdown` | 🟡 Low | Pin tsdown to an exact version |
| R5 | The source overlay (`.ts` rows) depends on an undocumented combination of behaviours | 🟡 Low | Avoidable — skipping that fast lane costs nothing |

### Still to verify

| Verification | Question | Done when |
|---|---|---|
| V1 | Do `link` and tarball installs resolve `@deepseek-ai/cordis` to the same path? | Print both paths and compare. Identical → strike R2 |
| V2 | Does the reproduced client preset actually run the emitted `lib/client.js` in jsdom? | The consistency test passes |

---

## 6. If it is ever published

Not now; the path is recorded here so the research does not have to be redone:

- **Channel**: an npm publish (prebuilt) or a `pnpm pack` tarball. **A git install does not work** — monorepo member packages have no addressable install entry, and `prepare` must be self-contained.
- **To add**: changesets, drop `private`, design peer ranges explicitly (the caret problem from §3.4 really bites here).
- **Could be given back to the ecosystem**: `plugin-lint` and the client preset both have real value — upstream has neither a plugin scaffold nor a published preset.

---

## 7. Sources

The facts come from the local DSH checkout (`/Users/rqc/r/github.com/deepseek-ai/deepseek-harness`, version line `0.1.5-rc.1`) and from measurements against the npm registry.

The two research notes, item by item with file paths and code snippets:

- [`docs/research/host-and-bundle-contract.md`](./docs/research/host-and-bundle-contract.md) — export contract, `Config`/`!!js`, patch semantics, install flow, profile layout, dependency rules, required manifest fields
- [`docs/research/client-half-build-contract.md`](./docs/research/client-half-build-contract.md) — `dsh.client` validation, artifact contract, baselines and the purity gate, HMR

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
| HMR driver | `packages/client/hmr/src/index.ts` |
| How to use the test-support packages | `packages/test-support/loader-smoke/README.md` |

**Local toolchain**: Node `v22.22.3` from the repo's nix devshell (`/nix/store/...-nodejs-22.22.3`), pnpm `11.7.0` from pnpm's own version management. Neither is a system install.
