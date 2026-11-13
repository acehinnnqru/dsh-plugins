# Out-of-tree DSH **browser-half (client) plugin** — exact contract

All paths relative to the DSH checkout root (read-only investigation).

## 1. `dsh.client` in package.json — schema, meaning, validation

**Type (the published schema):** `packages/util/package-manifest/src/types.ts:44-56`
```ts
export interface DshClientManifest {
  /** Client platform identifier; the Web consumer selects `web`. */
  platform: string
  /** Informational package-name dependencies, not Cordis service injection. */
  inject?: string[]
  /** Boot phase-one registration barrier; absent means the shared application batch. */
  immediately?: boolean
  /**
   * Exact module-table requests beyond the implicit client baseline, including
   * subpaths such as `<pkg>/client`; absent means baseline externals only.
   * Type-only imports are erased and create no module request.
   */
  external?: string[]
}
```
**Runtime validator (the authoritative one):** `packages/client/modules/src/index.ts:185-206` `parseDshClient()` — throws unless `platform` is a string, `inject`/`external` are string arrays (`optionalStringArray`, `src/client/manifest.ts:126-137`), `immediately` is boolean. Unknown extra fields are **not** rejected.
**Selection:** `packages/client/modules/src/index.ts:756-777` — reads `pkg.dsh.client`, then `if (decl === undefined || decl.platform !== 'web') { cache null; return null }`. So **`platform: 'web'` is the only value DSH acts on** (all 57 in-tree declarations use `"web"`; grep of `packages/*/*/package.json`).
**Same row also requires the bundle:** `clientExportOf()` at `index.ts:208-219` reads `exports["./client"]`, accepting a string or an object with a string `default`; a `dsh.client` without it throws `client-modules: <pkg> declares dsh.client but exports no "./client" bundle` (`:766-768`).
**Normalization to the wire row:** `PkgMeta` → `graphRow()` `index.ts:395-412` emits `WebBootEntry` (`src/client/manifest.ts:50-64`): `id` (= package name), `url`, `rev`, and optionally `inject`, `immediately: true`, `external` (omitted when empty).
**Meanings, restated by the in-repo rulebook** `packages/client/AGENTS.md` (new-package checklist item 3): `inject` = package-name edges that are *informational only* (preflight display, HMR diffing) — they do **not** sequence activation; activation order is Cordis service inject waiting. `immediately: true` = stage-one prefetch tier, "only for stage-one-prefetch infrastructure rows". `external` = a non-baseline module request that sequences its dynamic supplier before this consumer.
**Second reader (CI gate, in-repo only):** `scripts/verify-client-packages.ts:324-380` validates `external`/`inject` (no empties, no duplicates, no baseline repeat, supplier must exist, no self-request, no cycles, and for `packages/client/*` it *forbids* requesting another dynamic row at all).

## 2. The `exports["./client"]` artifact — format, exports, evaluation

**Resolution:** `index.ts:770-777` — `clientPath: join(dirname(pkgPath), clientRel)`, i.e. a package-relative path inside the package (e.g. `./lib/client.js`); served at `/plugins/??<pkg>/client.js&rev=<rev>` (`comboUrl()` `index.ts:239-242`).

**Format = single-file CommonJS classic script.** Not ESM, not an ES module script:
- `packages/client/tsdown.client.ts:428-568` (`clientConfig`): `format: 'cjs'`, `platform: 'browser'`, `outputOptions.entryFileNames: 'client.js'`, `dts: false`, `sourcemap: true`.
- Loaded with a plain `<script src>` element: `packages/client/modules/src/client/system.ts:14-27` `defaultLoadBundle` (`document.createElement('script')`), so top-level `import`/`export` would be a syntax error.
- Arrival without registration is a hard failure: `system.ts:~150` `bundle ${url} loaded without registering "${id}" via __ModuleLoader__.load`.

**What it must do — register a factory, and the returned exports must be the Cordis plugin object:**
```js
// tscdown.client.ts:566-568
banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
footer: 'return module.exports; } });',
intro: 'var module = { exports: {} }; var exports = module.exports;',
```
Real built artifact (`packages/client/ui-schedule/lib/client.js`):
```
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-schedule",
	factory: (require) => {
		var module = { exports: {} }; var exports = module.exports;
		... 
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
```
- `id` must be the package name (or `<pkg>/client`): `register()` keys on `stripClientSuffix(registration.id)` (`system.ts:114-121`, `manifest.ts:158-160`); a duplicate registration throws; a mismatched id fails the arrival check above.
- The returned exports are handed to Cordis after `unwrapExports` (`vendor/loader/src/index.ts:190-198`, `exports.default ?? exports`, then `__esModule` interop) and then `vendor/loader/src/config/entry.ts:280` `ctx.registry.plugin(plugin, config)`. `vendor/cordis/src/registry.ts:9,319-327`: valid plugin = a **function**, or an **object with `apply(ctx, config)`**; `inject`, `Config`, `name` are read off that object. **No default export is required or used**; DSH's own client halves export named `apply` + `inject` (see §7). `Config` (a schemastery schema) is optional and comes from the Loader row's `config`.

**Materialization (lazy-CJS table):** `packages/client/modules/src/client/system.ts` — the factory closure holds the whole module body (side effects, incl. CSS injection) and runs at first import:
- `materialize()` `:173-198` memoizes into `loadCache`, records owned `<style data-plugin>` tags, rejects require cycles (`factory-form CJS cannot deliver partial exports`).
- `makeRequire()` `:200-214` branch order: seed word → memoized record → registered factory → **throw** (`require("<spec>") missed the module table …`). Synchronous; cannot fetch.
- `import()` `:215-231` / `prefetch()` `:232-239` add the graph-row branch: `arriveGraphRow()` recursively loads `external` supplier rows and `inject` package rows *before* the consumer's own script.
**Importing other client packages:** yes, mechanically — declare the exact specifier in `dsh.client.external`; it becomes the row's `external`, the host adds the module-graph edge (`orderByModuleGraph` `index.ts:415-455`, rejecting self-requests and cycles), and the runtime resolves it through the table. `<pkg>/client` aliases the bare package row. **Policy forbids it for feature plugins:** `packages/client/AGENTS.md` export discipline #3 ("A feature plugin MUST NOT runtime-import or re-export another feature plugin's values, and MUST NOT declare `dsh.client.external` to obtain them"), enforced in-repo by `scripts/verify-client-packages.ts:355-361`.

## 3. What a client bundle may import (baseline / allowlist, runtime resolution)

**Baseline = `PLATFORM_MODULES`,** `packages/client/web/src/platform.ts:8-17` (as read from `@deepseek-ai/dsh-client-web@0.2.1-alpha.5`):
```ts
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  'zod', '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const
export const PRELOADED_CLIENT_EXTERNALS = [] as const   // currently empty
```
**Runtime supplier of those keys = the shell's frozen seed table:** `packages/client/web/src/seed.ts` `getStaticModules()` returns one static import per word, `satisfies Record<PlatformModule, unknown>`; passed as `staticModules` in `packages/client/web/src/boot.ts:70` and stored as the module system's `seed` (`system.ts:~90`). Resolution order at runtime is seed → memoized → registered factory → throw; there is no import map, no global, no dynamic fallback.
**Build-time externality rule:** `packages/client/tsdown.client.ts:406-411` `clientExternals(id) = PLATFORM_MODULES ∪ PRELOADED_CLIENT_EXTERNALS ∪ requestedExternals(id, dsh.client.external)`; `clientConfig` then sets `deps.neverBundle: isRequested`, `deps.alwaysBundle: (s) => !isRequested` — i.e. **only baseline + declared `external` stay as `require()`; everything else (your own code, clsx, third-party libs) is inlined.** A `require()` the table cannot answer is a guaranteed runtime throw.
**Purity gate (build error, mirror of the above):** `tsdown.client.ts:520-536` `dsh-client-bundle-purity` throws for any `@deepseek-ai/*` value import that is not requested/inline-safe:
`INLINE_SAFE` (`:61`) allows inlining only wire/contract layers: `@deepseek-ai/dsh-{file-reference,session,llm,tools,brand,deque,output-retention,typert-protocol,util-crypto,util-values,util-workspace-path}`, `dsh-token-meter/client`, `dsh-host-open-in-app/shared`, `dsh-agent-presets/display`, `dsh-spill-policy/notice`; plus vendored libraries `@deepseek-ai/{cosmokit,schemastery}` (`:67`) and generated `@deepseek-ai/dsh-*/remote` (`:70`). Type-only imports are erased and never reach the gate.

## 4. How DSH builds client halves, and what an out-of-tree build must do

**Pipeline:** `package.json:25` `"build:lib:client": "tsc -b tsconfig.client.json && tsdown --env.DSH_BUILD_FACE client"`; root `tsdown.config.ts:14-21` runs the same complete workspace (`vendor/*`, `packages/*/*`, `apps/cli`) for both faces and only flips `DSH_BUILD_FACE`. Package-local configs select their entries per face — `packages/client/tsdown.client.ts:105-124` `clientBundle(id, libEntry)`: Host pass → empty (`[SKIP_WORKSPACE_BUILD]`), Client pass → node lib **and** `clientConfig(id, 'lib/types/client/index.js')` (unset face → both, using `src/client/index.ts`).
**The shared preset is NOT published.** `packages/client/` has no `package.json` at all; `grep -rn "tsdown.client"` shows only in-repo relative imports (`packages/*/*/tsdown.config.ts` → `import { clientBundle } from '../tsdown.client.ts'`). `.agents/notes/archived/architecture/2026-08-12-plugin-owned-settings-surface.md:62` records it explicitly: "the `clientBundle` preset that emits it lives in `packages/client/tsdown.client.ts` rather than a published package". No npm-published helper for plugin authors exists (only `@deepseek-ai/dsh-typert-generator/tsdown` for Typert).
**Therefore an out-of-tree package must reproduce `clientConfig` itself** (copying `packages/client/tsdown.client.ts` is the practical route; repo is MIT). The required bundle properties, each from `clientConfig` `tsdown.client.ts:428-568`:
1. one entry → `lib/client.js`, `format: 'cjs'`, `platform: 'browser'`, `clean: false` (`:428-442`, `:559`);
2. externals exactly = baseline + own `dsh.client.external`, everything else bundled (`:463-478`);
3. the `__ModuleLoader__.load({id, factory})` banner/footer/intro with the **exact package name** (`:566-568`);
4. `define` substitutions for `process.env.NODE_ENV` and `import.meta.env(.MODE)` (CJS output cannot carry `import.meta`) (`:495-503`);
5. `sourcemap: true`, `sourcemapExcludeSources: false`, and a map whose `sourcesContent` is present — the host serves `/plugins/<id>/client.js.map` and HMR re-hashes bundle+map (`index.ts:342`; `docs/subsystems/client-modules.md` §bundle route);
6. CSS handled **inside** the bundle by lightningcss: `x.module.css` → hashed class map + a `<style data-plugin="<id>" data-plugin-css="<id>/<file>">` tag injected at factory execution; `x.css?inline` → compiled text; plain `.css` → injected tagged style (`:29-52`, `:537-556`). tsdown's own CSS pipeline is not used (`@tsdown/css` absent);
7. no code-splitting: only the single `exports["./client"]` file is addressable by the `/plugins/??<pkg>/client.js` route.
**Package/manifest side (non-bundler requirements):**
- the package needs a **Node half too** — the browser tree is composed *only* from graph rows that came from *active host Loader entries* (`packages/client/web/src/boot.ts:127-137`; scan at `index.ts:756`), so `exports["."]`/`main` must be importable by Node. Canonical minimal node half: `packages/client/ui-schedule/src/index.ts` = `export function apply(): void {}`;
- `files` must cover the artifact (`packages/client/ui-schedule/package.json` lists `"lib/client.js"`);
- the row must exist in an enabled host config layer: **out-of-tree that means a `dsh.bundle.patch` layer** with `- id: <x>` / `name: <your-package>` (in-tree equivalent: `packages/bundle/web-app/cordis.patch.yml:201-202`), installed with `dsh plugin --profile <p> add <pkg>`;
- if the bundle is missing at boot, composition fails loud: `MissingClientBundleError` "client bundle not found; run `pnpm run build` before launch" (`index.ts:85-98`).

## 5. HMR / dev story

- **Watcher lives in the host, not in your package.** `@deepseek-ai/dsh-client-hmr` node half (`packages/client/hmr/src/index.ts`) `syncWatches()` (`:118-134`) iterates `ctx.clientModules.graph().entries`, takes `artifactBaseline(row.id)` (path + mtime + size captured before the snapshot read) and stat-polls every row each `pollIntervalMs` (default **500**, `:36-37`); a changed/dirty row calls `ctx.clientModules.rebuilt(id)`, and only a real rev change is broadcast over SSE `GET /plugins/events`. Browser half swaps the fiber (`packages/client/hmr/src/client/index.ts` header). Row `client-hmr` is mounted by `packages/bundle/web-app/cordis.patch.yml:167-168`; `apps/cli/reference/README.md` (Web alias): "The client-plugin HMR receiver is always mounted and stays idle until a separate `pnpm run dev:web` watcher rebuilds client bundles."
- **What the author must run: a process that rewrites `lib/client.js`.** In-repo that is `pnpm run dev:web` (= `tsx scripts/dev-web.ts --poll`, `package.json:182`), which runs `tsc -b tsconfig.client.json --watch` + a tsdown watch over discovered packages + `vite build --watch`. Its discovery is **repo-only**: `discoverPluginDirs()` globs `packages/*/*/package.json` with `dsh.client.platform === 'web'` (`scripts/dev-web.ts:78-87`), so an **out-of-tree package is not watched by `dev:web`** — the author runs their own package build watcher (`"watch": "tsdown --watch"` in every client package script, e.g. `packages/client/ui-schedule/package.json`). `scripts/dev-web.ts` header states the design explicitly: "Reload signaling is not this script's business — the host webserver stat-polls the bundles it serves and broadcasts `rebuilt` frames itself (`dsh web`), so any process that rewrites `lib/client.js` files triggers reloads."
- Constraints recorded there: needs one prior full `pnpm run build` (stages are incremental, none bootstraps a missing tree), must not run concurrently with `pnpm run build`, and `--poll` matters on network mounts.

## 6. The out-of-tree example: `github.com/deepseek-harness/turtle-ui`

- `docs/user/develop/basic/publish.md` (Git-install section) names it as the canonical external example: "**The author** ships a `prepare` script — pnpm runs it after a git install — that builds the published entry points from source, self-contained: it must not assume dev-only context such as a sibling monorepo checkout. [turtle-ui](https://github.com/deepseek-harness/turtle-ui) is a working example: its `prepare` runs a dedicated tsdown config that transpiles `src/` without project references or type checking."
- `apps/cli/reference/README.md` (plugin management): `dsh plugin --profile tui add github:deepseek-harness/turtle-ui` … "Git-hosted plugins that ship sources build during install through their `prepare` script, which pnpm ≥10 blocks until the consumer allows it".
- That is **all** the repo says: it documents turtle-ui's *install-time* `prepare` build, **not** a client-half/`dsh.client` build config. No other in-tree mention (the other `turtle*` hits are a reviewer handle).
- **Unverified:** I could not inspect turtle-ui itself — `https://github.com/deepseek-harness/turtle-ui` and `raw.githubusercontent.com/.../{main,master}/package.json` return **404** to unauthenticated fetches, and `api.github.com` was rate-limited; web search was unavailable (401 on the configured search endpoint). So whether turtle-ui actually ships a `dsh.client` browser half, and what its tsdown config contains, is **not confirmed** in this session.

## 7. Minimal real client-plugin source shape (Cordis client API)

`packages/client/ui-schedule/src/client/index.ts` (complete registration body, 35 lines):
```ts
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'          // Context merges, type-only
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'     // ctx.slots
import { ScheduleCatalogAction } from './ScheduleCatalogAction.tsx'
import { en, NS, zh } from './locales.ts'

export const inject = ['slots', 'locale']        // Cordis SERVICE names (not package names)

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-schedule: dictionaries')
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'schedule-catalog', order: 10, locale: NS,
  }, ScheduleCatalogAction))
}
```
No default export, no `name` needed. Surface actually used across plugins: `ctx.provide(name, service)` / `ctx.get` (ui-theme provides `theme`), `ctx.effect(fn, label)` for teardown, `ctx.on(event, fn)` (+ module-augmented `Events`), `ctx.inject(services, cb)`, `ctx.plugin(child)`, and UI registration only through `ctx.slots.inject(name, () => ctx.slots.register({ name, id?, key?, order?, store?, locale?, children?, inject? }, Component))` (`packages/client/AGENTS.md` "one API"), with `ctx.modules` available as the client module table. Cross-plugin value imports are forbidden; declarations cross via `import type`, behavior via Cordis services, UI via slots. Cordis DI `inject` in the source is unrelated to `dsh.client.inject` (ui-schedule declares three packages in the manifest but only `['slots','locale']` services in source).
