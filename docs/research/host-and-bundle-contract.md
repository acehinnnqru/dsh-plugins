# DSH out-of-tree plugin contract — evidence report

Repo: the DSH checkout (read-only; HEAD 183f08e9c).
All line numbers below were read directly unless marked UNCERTAIN.

## 1. Host plugin entry-module export contract

- Minimum: a module whose resolved value has `apply(ctx, config)`. `docs/user/develop/basic/index.md:17` "a plugin is a TypeScript module that exports an `apply` function"; `:22-27` `export const name = 'my-plugin'` + `export function apply(ctx: Context)`.
- Three accepted shapes: function, object `{ name, inject, apply }`, class `extends Service` (`docs/user/develop/basic/index.md:106-136`).
- Named exports and default export both work; the Loader unwraps default first: `vendor/loader/src/index.ts:192-198` `exports = exports.default ?? exports; ... return exports.default ?? exports`.
- Metadata contract (`vendor/cordis/src/registry.ts:96-118`, `Plugin.Base`): `name?` "Display name used for fiber diagnostics and logger names"; `Config?: StandardSchemaV1<any, T>` "Standard-schema validator applied to config before the plugin starts"; `inject?: Inject`; `provide?`; `intercept?`. Invalid shapes throw: `registry.ts:318` `throw new Error('invalid plugin, expect function or object with an "apply" method, received ' + typeof plugin)`.
- `inject` = `string[]` or name→config map (`registry.ts:65-89`); loading waits for every service and unloads when one disappears (`docs/user/develop/framework/index.md:28-38`). Function-form metadata must be named exports (`docs/user/develop/basic/tool.md:16-17`).
- `reusable`: NOT part of this contract. Zero hits in `vendor/cordis` (v4.0.2), `vendor/loader`, or `docs/`. Do not export it.
- Real package: `packages/todo/tool-todo/src/index.ts:22-23` `export const name = 'tool-todo'` / `export const inject = ['tools', 'sessionProjections']`; `:29-43` `export interface Config { allowParallelInProgress: boolean }` + `export const Config: z<Config> = z.object({ allowParallelInProgress: z.boolean().required() })`; `:128` `export function apply(ctx: Context, config: Config): void`.
- Cleanup: every `ctx` registration is disposed on unload; explicit resources use `ctx.effect(() => disposer)` (`docs/user/develop/basic/index.md:68-85`, `docs/user/develop/framework/index.md:40-63`).

## 2. Config schema convention

- Taught convention is Schemastery: `docs/user/develop/basic/config.md:9-31` `export const Config: Schema<Config> = Schema.object({ greeting: Schema.string().default('Hello'), ... })`; `:45` "Do not export a plain object as `Config`; it does not implement the Standard Schema interface required by Cordis."
- Runtime accepts ANY StandardSchemaV1, not only Schemastery: `vendor/cordis/src/registry.ts:104`; `vendor/cordis/src/fiber.ts:53` `const result = runtime.Config['~standard'].validate(config)`. Zod v4 is used in-tree: `packages/context/time-context/src/index.ts:10,57` `import { z as zod } from 'zod'` + `export const Config: z<Config> = z.object({...})`. Schemastery is what the generated config catalog reads (`docs/config-catalog.md:1-6` cross-checks "the runtime schemastery schema against the pasted declaration") — prefer Schemastery for surfaces/tooling. UNCERTAIN: whether any settings UI consumes zod schemas.
- Placement: `@deepseek-ai/schemastery` goes in `dependencies` (`docs/cookbook/adding-a-package.md:25` "it is a runtime validator"), matching `packages/todo/tool-todo/package.json`.
- `!!js` config expressions: the patch YAML dialect registers a `tag:yaml.org,2002:js` scalar that parses to `{ __jsExpr: string }` (`vendor/include/src/index.ts:9-23`); each row's config is interpolated in that row's own fiber after injections resolve (`vendor/loader/src/index.ts:89-100` → `interpolate(this.ctx, config)`; evaluator `vendor/loader/src/config/utils.ts:4-8` `new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')`). Expressions may read `process.env` and injected services, are re-evaluated on live patch reload, and print unevaluated under `--dump-config` (`apps/cli/reference/README.md:28,51`).
- Real rows:
  - `packages/bundle/web-app/cordis.patch.yml:135-140`: `- id: webserver` / `name: '@deepseek-ai/dsh-host-webserver'` / `inject: [webStartup]` / `host: !!js ctx.webStartup.host ?? '127.0.0.1'` / `port: !!js ctx.webStartup.port ?? 3080`.
  - `packages/bundle/base/cordis.patch.yml:211-212`: `mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'` / `workspaceRoot: !!js process.cwd()`.
  - User patch example `docs/user/guide/mcp-memory.md:88-99`: `- insert:` … `cwd: !!js process.cwd()`.

## 3. Bundle mechanism — `cordis.patch.yml` format and operations

- Bundle manifest: `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` (`docs/user/develop/basic/publish.md:42`; `packages/bundle/base/package.json:31-34`; all six bundles identical). `patch` is required and relative to the package root (`packages/util/package-manifest/src/types.ts:27-30`).
- File must be a top-level YAML array or boot fails: `packages/boot/app-boot/src/index.ts:358-361` "must be a top-level YAML array of loader patch entries".
- Exactly TWO operations; `applyEntryPatches` is documented as "THE patch semantics" (`vendor/include/src/index.ts:43-57`, body `:58-128`):
  1. `insert: [rows...]` — appended to the root list; with a top-level `id:` it is appended into that row's `config` array and the target must be a group (`:80-95`, warnings "entry %C not found" / "is not a group").
  2. Id-targeted override — `const { id, insert, name, ...overrides } = patch` … `target[key] = value` (`:78`, `:121-124`). Any key works (`PatchOptions` has `[key: string]: any`, `:145-156`).
  - There is NO remove operation. Rows are neutralized with `disabled: true`: `packages/bundle/web-app/cordis.patch.yml:358-360` "Disabling rather than deleting is deliberate: the base is shared, and a row absent from a surface overlay would silently reappear the day someone reorders the composition."
  - In an override patch, `name` is an assertion, not a rename: `:116-119` `if (name && name !== target.name) warn('patch: name mismatch for %C ... skipping')`.
  - A patch replaces the targeted row's WHOLE `config` (no deep merge): `packages/bundle/base/cordis.patch.yml:7-9`; `docs/user/develop/basic/publish.md:123`.
  - Inserted rows are indexed immediately, so a later patch — in the same file or a later layer — can target them (`:96-101`).
  - Unmatched patch = warning + skip; malformed/unparsable file = hard failure (`packages/boot/app-boot/src/index.ts:315-323,349-356`).
- Row fields (`vendor/loader/src/config/entry.ts:9-22`): `id` (stable id), `name` (module specifier imported by the entry tree), `config`, `group`, `disabled`, `inject`. `disabled` may itself be `!!js` (`entry.ts:104-107`).
- Name resolution: rows are `import()`-ed by the Loader (`vendor/loader/src/config/tree.ts:145-161`); bare names resolve from the composed root config's directory = the profile dir (`apps/cli/src/profile-boot.ts:799` `ctx.baseUrl = pathToFileURL(dirname(absoluteConfigPath)).href + '/'`), whose parent walk reaches `$DSH_HOME/profiles/node_modules` (`apps/cli/reference/README.md:11`). Relative names inserted by a patch are rewritten to `file://` URLs beside the patch at parse time (`packages/boot/app-boot/src/index.ts:326-337`). Subpath exports work: `name: '@deepseek-ai/dsh-web-app/startup'` (`packages/bundle/web-app/cordis.patch.yml:128`).
- Group insert example: `packages/boot/app-boot/tests/user-patches.spec.ts:106-110` `{ id: 'nested', name: 'cordis:group', group: true, config: [ { id: 'child', name: pluginPath } ] }`; `cordis:group` is a Loader builtin (`packages/boot/app-boot/src/index.ts:536-541`).

## 4. Install flow, profile layout, layer precedence, `--dump-config`

- `dsh plugin --profile <name> <args...>` is a "thin pnpm forwarder": init the profile if missing, run `pnpm <args...>` with cwd = profile dir, then reconcile bundles (`apps/cli/src/plugin.ts:1-11,120-138`). Every pnpm verb works (`add/remove/why/update/install`). Relative path specs are anchored to the invoking directory (`plugin.ts:104-112`).
- Reconciliation: each dependency resolving to a manifest with `dsh.bundle.patch` is appended to `dsh.profile.bundles`; bundle-less dependencies warn "declares no dsh.bundle — installed as a plain dependency, not a profile layer"; removed dependencies leave the list (`plugin.ts:59-91`).
- Profile directory `$DSH_HOME/profiles/<name>` (default home `~/.dsh`):
  - `package.json` — `{ name: "dsh-profile-<name>", private: true, dependencies: {}, dsh: { profile: { bundles: [...], patchReload } } }` (`packages/boot/app-boot/src/profile.ts:176-185`).
  - `cordis.patch.yml` — user layer, initialized to `[]` (`profile.ts:144-148,186-187`).
  - `pnpm-workspace.yaml` — `packages: ['.']`, `nodeLinker: hoisted`, `autoInstallPeers: false` (`profile.ts:150-160,188-189`).
  - `cordis.yml` — the empty root entry list, rewritten on every launch (`apps/cli/src/profile-boot.ts:84-91,190`).
  - `node_modules/` + `.dsh-module-fallback/`, plus the shared `$DSH_HOME/profiles/node_modules` fallback mirroring the installation closure (`profile.ts:47-48,540-565`).
- Layer precedence (`apps/cli/src/profile-boot.ts:206-243`): bundle patches in `dsh.profile.bundles` order → profile `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` overlays in argv order → launcher telemetry switch (internal). All layers are flattened into ONE `applyEntryPatches` call over `[]` (`packages/boot/app-boot/src/profile.ts:847-852` `composeEntries`), so later layers win per row.
- `dsh.profile.patchReload`: `'live'` (default for custom profiles and `web`) vs `'startup'` (headless/sdk/acp/sdk-minimal) (`profile.ts:110-142`; validation `:783-788`).
- `--dump-config` / `--dump-default-config`: compose without booting; print `# ==` comments naming the file that supplied each row and the layers that patched it; `!!js` stays unevaluated; unmatched targets are reported on stderr; app arguments are rejected (`apps/cli/src/dump-config.ts:31-58`; `apps/cli/reference/README.md:44-51`).
- Bundle membership is frozen at profile start: "a running Profile keeps the Bundle set from its current start. Restart that Profile after adding, removing, or updating a Bundle" (`apps/cli/reference/README.md:67`).
- Shipped templates auto-initialize on first use (`packages/boot/app-boot/src/profile.ts:110-139`): `web` = base + web-app (live); `headless`/`sdk`/`acp` = base + app bundle; `sdk-minimal` standalone; any other name = `@deepseek-ai/dsh-base` alone (`DEFAULT_PROFILE_BUNDLES`).

## 5. Git install: `prepare`, `allowBuilds`, distribution forms

- Git installs fetch sources, not artifacts: nothing runs `build`, so a TypeScript package arrives without `lib/`. The author must ship a `prepare` script that "builds the published entry points from source, self-contained: it must not assume dev-only context such as a sibling monorepo checkout" (`docs/user/develop/basic/publish.md:161-163`); turtle-ui is cited as the working example ("a dedicated tsdown config that transpiles `src/` without project references or type checking").
- Consumer side: pnpm ≥10 refuses a git dependency's `prepare` until allowlisted; the first `add` fails, and `dsh` prints its own pointer (`apps/cli/src/plugin.ts:150-160`). Fix lives in the PROFILE's `pnpm-workspace.yaml` (`publish.md:164-171`):
  `allowBuilds:` / `  dsh-hello-plugin: true`, then re-run the `add`. Treat as "permission to execute the package's code on your machine at install time"; pin a commit (`github:you/hello-plugin#<sha>`).
- Recommended forms: npm publish with prebuilt `lib/` (no allowance), tarball from `pnpm pack` (`dsh plugin add ./hello-plugin-0.1.0.tgz`), local checkout / `link:` (no allowance), then git+`prepare` (needs allowBuilds) (`publish.md:175-178`; `apps/cli/reference/README.md:75`).
- `dsh` resolves `pnpm` from PATH and exits 127 with "pnpm not found on PATH" (`apps/cli/src/plugin.ts:139-144`); the repo itself pins `pnpm@11.7.0` (`package.json:7`).

## 6. Dependencies for an OUT-OF-TREE package

- Published surface: `packages/!(experimental)/*/package.json`, `apps/*/package.json`, `vendor/*/package.json` plus 5 whitelisted experimental dirs (`scripts/publish-npm-baseline.ts:24-31`; `scripts/experimental-package-policy.ts:2-8`). 274 manifests declare `"publishConfig": { "access": "public" }`.
- Two version lines:
  - vendor: `@deepseek-ai/cordis@4.0.2`, `@deepseek-ai/schemastery@3.18.2`, `@deepseek-ai/cordis-plugin-loader@1.0.3`, `-include@1.0.7`, `-timer@1.1.4`, `-hmr@1.0.17` (upstream versions kept).
  - dsh family: `@deepseek-ai/dsh-*` and the bundles all at **0.1.5-rc.1**; one version for all release members (`package.json:3`; `scripts/release/families.ts:348` "dsh release members must share one version").
- `workspace:^` publishes as `^<version>` (`scripts/benchmark-npm-resolution.ts:177-183`). Registry-verified: `@deepseek-ai/dsh-tool-todo@0.1.5-rc.1` ships `"peerDependencies": { "@deepseek-ai/cordis": "^4.0.2", "@deepseek-ai/dsh-tools": "^0.1.5-rc.1", ... }` and `"dependencies": { "zod": "^4.4.3", "@deepseek-ai/schemastery": "^3.18.2" }`; `@deepseek-ai/dsh@latest` = 0.1.5-rc.1 with `bin: { dsh: "lib/bin.js" }`.
- Rule (strongly implied, NOT documented for third parties — flagged):
  - `@deepseek-ai/cordis` and any in-box package whose identity must be shared → **peerDependencies**, never `dependencies`. Rationale, `packages/boot/app-boot/src/profile.ts:150-154`: with the hoisted linker + `autoInstallPeers: false`, "missing peers (cordis and friends) fall through to the healed profiles/node_modules installation fallback, so every plugin shares the installation's single cordis instance instead of a duplicate".
  - 267 of 269 workspace manifests put cordis in `peerDependencies`; the only exceptions are the deployment roots `@deepseek-ai/dsh` (`apps/cli`) and the private `apps/desktop-host`.
  - Mirror each peer into `devDependencies` at the same range for local build/typecheck (`docs/cookbook/adding-a-package.md:25`; enforced in-tree by `scripts/verify-package-dependencies.ts:574,682` and `scripts/check-workspace-constraints.ts:405-408` — their globs cover only this repo, so nothing validates your manifest).
  - Pure libraries (`zod`, `@deepseek-ai/schemastery`, `diff`, …) → `dependencies`; duplicate-safe. In-tree examples: `packages/todo/tool-todo/package.json` (zod, schemastery), `packages/fs/tool-fs/package.json` (diff).
  - Anti-pattern: "Omitting them from the published dependency graph makes the package depend on accidental hoisting by a profile" (`.agents/notes/implemented/process/2026-08-26-published-dependency-faces.md:87`).
  - UNCERTAIN/TRAP: prerelease peer ranges are narrow. `^0.1.5-rc.1` = `>=0.1.5-rc.1 <0.2.0`, and semver does not match later prereleases such as `0.1.6-rc.1` unless the range carries a prerelease on that same tuple. No DSH doc covers third-party peer ranges across rc bumps — verify against the registry per release instead of assuming.

## 7. Discoverability and metadata

- Topic: `README.md:46` "Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability."; `CONTRIBUTING.md:15` same. No registry/marketplace/catalog of community plugins exists in the repo.
- Loader-required: `dsh.bundle.patch` (string, package-relative). Listing a bundle-less package in `dsh.profile.bundles` throws (`packages/boot/app-boot/src/profile.ts:792-795` "declares no dsh.bundle in its package.json"); merely installing one warns (`apps/cli/src/plugin.ts:72`).
- Other surfaces require `name` (exact match) + a string `version` + a non-empty `dsh.bundle.patch` resolving inside the package root (`apps/desktop/src/project-manager.ts:311-320`); `packages/llm/plugin-package-inventory-deepseek/src/index.ts:66` "must declare non-empty name and version".
- NOT required out-of-tree: `keywords`, `repository`, `description`, `license`, `files`, `type: module`, `main` — the tutorial manifest is a convention (`docs/user/develop/basic/publish.md:36-44`), and the `dsh` key is read with ad-hoc `?.` access, unknown keys are not rejected (`packages/util/package-manifest/src/index.ts:3` "Each reader owns JSON validation and resolved defaults"). 0 of 279 in-tree manifests declare `keywords`. Recommended (not enforced): mirror the in-box shape — `type: module`, `main`/`exports`, `files`, `license`, `repository`, `publishConfig.access=public`.
- Inventory UI imposes no metadata requirement: `packages/host/plugin-inventory/src/types.ts:16-23` exposes only `{ entryId, moduleName, enabled, fiberPhase }` from `ctx.loader.entries()`; the client tab derives a display name from the module name and shows entryId, state, config state, phase (`packages/client/ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.tsx:58-64,300-372`). No version/description/schema is read from `package.json`.
- Optional browser half: `dsh.client` with required `platform` (`'web'`) and a matching `exports["./client"]`, else discovery skips/throws (`packages/util/package-manifest/src/types.ts:44-57`; `packages/client/modules/src/index.ts:189-199,755-770`).

## 8. Scaffold/template tooling

- None for plugins. No hits for `create-dsh-plugin`, `create-dsh`, or `plugin create` (excluding node_modules/lockfile/internal history); the only "generator" package is `packages/typert/generator` (type generator, unrelated). CLI subcommands are only `web` and `plugin` (`apps/cli/src/args.ts:175,190`).
- Only PROFILE scaffolding exists: `dsh --profile <name> --from-default-profile <template>` copies a shipped template's bundle list + `patchReload` into a fresh profile dir (`apps/cli/src/args.ts:146`; `apps/cli/reference/README.md:15`); `PROFILE_TEMPLATES` `packages/boot/app-boot/src/profile.ts:110-131`; `initProfile` `:170-190`. Plugin authors hand-copy from `docs/user/develop/basic/{index,tool,config,publish}.md` and the six `packages/bundle/*` packages.
