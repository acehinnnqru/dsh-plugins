# DSH client plugin extension points — what an out-of-tree plugin with a host half + browser half can do

Read-only investigation of the DSH checkout `/Users/rqc/r/github.com/deepseek-ai/deepseek-harness`
(version line 0.1.5-rc.1). Line numbers are from the files as read; nothing in the checkout was modified.
Companion notes: `client-half-build-contract.md` (manifest + bundle format), `host-and-bundle-contract.md`.

## 0. Answers in one table

| Question | Answer |
|---|---|
| Register a new document viewer/body for the Sidebar preview | **Yes**, from any client plugin, through the Cordis service `ctx.documentPreviews` + the keyed slot `sidebar.right.tab.document`. No in-package entry needed. |
| Register/override UI in existing slots | **Yes**: `ctx.slots.register()` into a slot some other package declared, wrapped in `ctx.slots.inject(key, …)`. Override by keyed/named **priority** shadowing. |
| Add a whole new Sidebar tab type | **Yes**: `ctx.sidebarRightTabs.register(definition)` + body into keyed `sidebar.right.pane.tab`. |
| Declare a brand-new slot of its own | Yes, as `children` on its own registration, but **only in the component that renders that location**; declaring a slot another entry already declared throws. |
| Host → browser data | **Yes**, three working paths: typert Remote namespace (typed RPC + streams), a `ctx.webServer` HTTP route + same-origin fetch, or reusing the already-mounted `workspaceFiles` namespace. Forwarded Cordis events are a closed allowlist. |
| Manifest-declared slot contributions | **Do not exist.** `dsh.client` has exactly `platform`, `inject`, `immediately`, `external`. Contributions are code inside `apply()`. |

## 1. The document-preview extension contract

### 1.1 Owner and its host half

- Package `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`, `package.json` exports `.` (host) and `./client` (browser).
- Host half is deliberately empty — `src/index.ts:1-4`:
  ```ts
  /** Pure host half; the whole preview lives in the browser export. */

  /** Host plugin body: the preview contributes nothing to the host tree. */
  export function apply(): void {}
  ```
  So there is **no host-side viewer extension point**; all extension happens in the browser half.

### 1.2 Two registrations make one viewer

`src/client/document/registry.ts:8-21` — the metadata contract (verbatim):

```ts
export interface DocumentPreviewDefinition {
  /** Unique implementation name, also used as the document slot key. */
  readonly id: string
  /** File suffixes without a leading dot; compound suffixes such as tar.gz are accepted. */
  readonly extensions: readonly string[]
  /** External implementations win over product implementations; defaults to extension. */
  readonly priority?: 'builtin' | 'extension'
  /** Localized implementation label, evaluated when the toolbar renders. @returns the visible name. */
  readonly title: () => string
  /** Content delivery mode supplied by the document owner. */
  readonly loading: DocumentLoadMode
  /** Whether the implementation consumes the document's wrap preference. */
  readonly wrap?: boolean
}
```

`DocumentLoadMode = 'text-pages' | 'bytes-complete'` (`registry.ts:5`).

The body is a React component in the **keyed** slot `sidebar.right.tab.document`, under the **same `id`**.

### 1.3 The registry is a real Cordis service, named `documentPreviews`

- Runtime provision — `src/client/index.ts:86-88`:
  ```ts
  const previews = new DocumentPreviewRegistry()
  const disposePreviews = ctx.reflect.provide('documentPreviews', previews)
  ctx.effect(() => disposePreviews)
  ```
- Type surface — `src/client/index.ts:51-56` (published in `lib/types/client/index.d.ts:23-27`):
  ```ts
  declare module '@deepseek-ai/cordis' {
    interface Context {
      /** File-extension renderer registrations, independent from their keyed document bodies. */
      documentPreviews: DocumentPreviewRegistry
    }
  }
  ```
- `ctx.reflect.provide` registers a genuine Cordis service entry (`vendor/cordis/src/reflect.ts:277-305`: writes `{ type: 'service', value, fiber }`, notifies dependents, disposer deletes it). Therefore a consumer declares `inject: ['documentPreviews']` (or reads `ctx.get('documentPreviews')`) exactly like any service.
- Service interface — `src/client/document/registry.ts:49-102`:
  `getSnapshot(): readonly DocumentPreviewDefinition[]`, `subscribe(listener): () => void`,
  `register(definition): () => void` (throws on duplicate live id: `documentPreviews: duplicate implementation "<id>"`, line 77),
  `candidates(path): readonly DocumentPreviewDefinition[]`.
- `DocumentPreviewRegistry` and `DocumentPreviewDefinition`/`DocumentLoadMode` are exported from the package's `./client` entry as **types** (`src/client/index.ts:48-49`); the class instance is only reached through the service, so no runtime import of that package is needed.

### 1.4 What the viewer must implement (exact registration)

In-package reference implementation, `src/client/code/index.ts:12-25` (verbatim):

```ts
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.documentPreviews.register({
    id: ID,
    extensions: CODE_EXTENSIONS,
    priority: 'builtin',
    title: () => t('title'),
    loading: 'text-pages',
    wrap: true,
  }))
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
    { name: 'sidebar.right.tab.document', key: ID, locale: NS }, CodeBody,
  )))
}
```

with `const ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code'` and
`const NS = 'sidebarCodePreview'` (`code/index.ts:8-9`). Other variants: `text/index.ts:20-26`
(`extensions: []` fallback), `markdown/index.ts`, `image/index.ts:34-41` (`loading: 'bytes-complete'`),
`pdf/index.ts` (declares a store seat + inject face), `html/index.ts` (injects a `readRelated` callback).

A viewer body's props are `DocumentPreviewProps = PropsRuntime<'sidebar.right.tab.document'>`
(`src/client/document/contract.ts:48`). Smallest real body: `src/client/text/TextBody.tsx:8-10`
(`{ content, useTabInfo }`). Composed shares come from the slot contract below.

### 1.5 The slot declaration (owned by the preview, not by viewers)

`src/client/document/contract.ts:21-45` (verbatim core):

```ts
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Document body selected by a registered implementation id. */
    'sidebar.right.tab.document': {
      kind: 'keyed'
      scope: 'session'
      owner: {
        readonly resourceAddress: string
        readonly content: DocumentContent
        readonly wrap: boolean
        readonly scrollportRef: RefCallback<HTMLElement>
      }
      hookContext: UseSidebarRightTabInfo
      inject: {
        hooks: {
          tabInfo: SlotHookFactory<'sidebar.right.tab.document', UseSidebarRightTabInfo>
        }
      }
    }
  }
}
```

`DocumentContent = { kind: 'text'; text; pages; eof } | { kind: 'bytes'; data: Uint8Array<ArrayBuffer> }`
(`contract.ts:17-19`). The runtime declaration + dispatch is one table:
`src/client/index.ts:98-107` registers the `text` tab body with
`children: { 'sidebar.right.tab.document': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: documentTabInfoFactory } } } }`,
and `TextPreview.tsx:300-305` dispatches it:

```tsx
{content !== undefined && renderSlot('sidebar.right.tab.document', {
  resourceAddress: tab.contentId, content, wrap: state.wrap, scrollportRef: bindScrollport,
}, {
  entryKey: selected.id, hookContext: useTabInfo,
  fallback: <p className={css.statusLine}>{t('rendererUnavailable', { name: selected.title() })}</p>,
})}
```

Because the slot-level inject face belongs to the declaration
(`packages/client/ui-slots/src/index.ts:126-131`), **every** viewer body automatically receives the
bound `useTabInfo` hook and the framework's `useResource`; it does not declare anything itself.

### 1.6 Selection and ordering among viewers

`src/client/document/registry.ts:29-46` `matchingDocumentPreviews`:
rank = `definition.priority === 'builtin' ? 0 : 1` (so *anything not marked builtin*, including an
omitted priority, is the higher "extension" band), then the longest matching suffix, then registration order.
`TextPreview.tsx:88-93` appends the plain-text fallback (`PLAIN_BODY_ID`) after the matched candidates and
picks the stored `rendererId` if it is still available, else the first candidate.
The toolbar only shows the wrap toggle when the selected definition says `wrap: true` (`README.md:30`).

### 1.7 Can a third-party plugin register a viewer? Yes — with three constraints

Evidence that this is the intended public path:
- `README.md:33`: "Document implementations register metadata with
  `ctx.documentPreviews.register({ id, extensions, priority, title, loading, wrap? })` and a body under the same `id`
  in the keyed, Session-scoped `sidebar.right.tab.document` child slot."
- `docs/subsystems/sidebar-right.md:109`: "Its root registration declares `sidebar.right.tab.document` and provides
  `ctx.documentPreviews`. A renderer registers … then waits through `ctx.slots.inject('sidebar.right.tab.document', ...)`."
- The package's own tests register renderers from **outside** the package body:
  `tests/document-seat.client.spec.tsx:71-92` uses `rt.ctx.documentPreviews.register({ id, extensions: ['md'], priority, … })`
  plus `rt.slots.inject('sidebar.right.tab.document', () => rt.slots.register({ name: …, key: id }, …))`;
  `:135-168` proves an `'extension'`-band viewer takes over from the builtin Markdown viewer and the builtin resumes
  when it is removed.
- `DocumentPreviewDefinition.priority` documents the `'extension'` band as "external implementations win over product
  implementations" (`registry.ts:13-14`).

Constraints (all from the code above):
1. The owner package must be loaded, because it is what provides `documentPreviews` and declares the child slot.
   A consumer must not declare `sidebar.right.tab.document` itself: a second declarer throws
   (`packages/client/ui-slots/src/index.ts:864-871`, "slot … is already declared (by …)").
2. The viewer's `id` must be globally unique among live registrations (`registry.ts:76-78`).
3. The viewer does no file I/O: the owner reads content (`loading` decides pages vs complete bytes) and delivers it as
   `content`. File *metadata* comes from the standard `useResource<'file'>(resourceAddress)` served by the
   `file` provider (`README.md:43-47`); direct reads, if a viewer wants its own, are the already-mounted
   `ctx.remote.workspaceFiles.*` calls (`src/client/rpc.ts:80-82`, `src/client/html/index.ts:23-31`).

## 2. The slot system

### 2.1 Services and API

- Service `slots` — `packages/client/ui-renderer/src/client/registry.ts:134` (`super(ctx, 'slots')`), class `SlotRegistry`
  extends Cordis `Service`; the registry core is `packages/client/ui-slots/src/index.ts:717+` (`SlotCore`).
- Contribute: `ctx.slots.register(options, Component) => disposer`
  (typed overloads `ui-slots/src/index.ts:780-825`; options `BaseOptions` `:566-589` +
  `KindOptions` keyed `key`/`priority`, list `id`/`order`/`label`/`priority`, chain `select`/`priority` `:519-548`).
- Wait for another package's declaration: `ctx.slots.inject(key, callback) => disposer`
  (`ui-renderer/src/client/registry.ts:172-234`): the callback runs for each declaration lifetime, synchronously if the
  slot is already declared, and its effects are torn down when the declaration collapses.
- Props types: `PropsRuntime<K>` (owner + session/global standard kits + slot inject face), `PropsRenderSlots`,
  `PropsStore`, `InjectFace`, `ComposedProps` (`ui-slots/src/index.ts:222-232, 342-369, 481-489`).
- Declaring your own child slot: `children: { '<key>': { kind, scope, inject? } }` on your own registration
  (`ui-slots/src/index.ts:149-155, 864-928`); declaring is claiming — the declaring entry is the only one authorized to
  render that key (`README.md` of ui-slots, "Declaration discipline", `:38-40`).

### 2.2 Canonical slot-id list

Every slot id in the product is a member of the declaration-merged `SlotMap` interface
(`packages/client/ui-slots/src/index.ts:26`). The complete set of declaring files and their keys:

| Declaring file:line | Slot id (kind / scope) |
|---|---|
| `ui-renderer/src/client/registry.ts:43` | `root` (single/root) — the only framework-seeded slot |
| `ui-layout/src/client/index.ts:61` | `sidebar` (single/root) |
| `ui-layout/src/client/index.ts:66` | `main` (keyed/root) |
| `ui-layout/src/client/index.ts:80` | `rightbar` (single/root) |
| `ui-layout/src/client/index.ts:91` | `shell.overlay` (list/root) |
| `ui-sidebar/src/client/contract/slots.ts:22,27,32,39,45,50` | `sidebar.brand.mark`, `sidebar.brand.name`, `sidebar.panellist`, `sidebar.workspaces`, `sidebar.settings`, `sidebar.footer.action` |
| `ui-sidebar-right/src/client/contract/slots.ts:42,50,64,75,86` | `rightbar.session` (single/session), `sidebar.right.pane.tab` (keyed/session, inject `SidebarRightTabInjected`), `sidebar.right.pane.tab.title` (keyed), `sidebar.right.tab.guide` (chain), `sidebar.right.tab.menu.item` (list) |
| `ui-sidebar-documentpreview/src/client/document/contract.ts:24` | `sidebar.right.tab.document` (keyed/session) |
| `ui-conversation/src/client/contract/slots.ts:121-186` | `main.conversation`, `conversation.session`, `conversation.session.header`, `…header.lineage`, `…header.actions`, `…header.utilities`, `…header.corner`, `conversation.view`, `conversation.composer` (chain), `conversation.hero.workspace`, `conversation.hero.brand.mark`, `conversation.hero.agentPreset`, `conversation.input.dock`, `conversation.input.overlay`, `conversation.composer.dock`, `conversation.input.left`, `conversation.input.right`, `conversation.composer.bar`, `conversation.input.attachments`, `conversation.input.plan`, `conversation.input.model` |
| `ui-chat/src/client/contract/slots.ts:182-213` | `conversation.chat.node` (keyed), `conversation.message.images`, `conversation.chat.commandview` (keyed), `conversation.chat.turnTail` (chain), `conversation.chat.assistant-actions` (list) |
| `ui-tool/src/client/contract/slots.ts:26,40` | `tool.call.toolview` (keyed), `tool.call.images` |
| `ui-trajectory/src/client/trajectory-contract.ts:98` | `conversation.trajectory.images` |
| `ui-approval/src/client/contract/slots.ts:37` | `conversation.approval.detail` |
| `ui-settings/src/client/contract/slots.ts:24,30,36,42,54,63,74,89` | `settings.trigger`, `settings.header`, `settings.action` (list), `settings.close`, `settings.section` (list), `settings.plugins.tab` (list), `settings.onboarding` (list), `settings.general.item` (list) |
| `ui-settings-plugins/…:19`, `ui-settings-models/…:33,38`, `ui-workspace/…:57,59`, `extensions/ui-cordis/…:31` | `settings.plugin.item` (keyed); `settings.models.provider-card` (keyed) + `settings.models.footer` (list); `conversation.hero.workspace.directoryFlow` + `sidebar.workspaces.directoryFlow`; `tool.view.cordis` (keyed) |

Scopes/kinds for every entry are readable at those lines; contributors never re-declare a key — they only need the
declaration in their *type* graph (`import type {} from '<declaring-pkg>/client'`) and the runtime declaration live.

### 2.3 How a plugin declares a contribution (and what the manifest does NOT do)

- The only runtime API is `ctx.slots.register` / `ctx.slots.inject` inside the client plugin's `apply()`.
- `dsh.client` carries **no** slot list. Type — `packages/util/package-manifest/src/types.ts:44-57`:
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
- Runtime validator — `packages/client/modules/src/index.ts:186-206` `parseDshClient()`: requires a string `platform`,
  string arrays for `inject`/`external`, boolean `immediately`; **unknown keys are silently dropped**, so a `slots`
  field would be ignored, not honored. The client entry is `exports["./client"]` only
  (`clientExportOf` `:208-219`; a `dsh.client` without it throws at `:766-768`), and the row is selected only when
  `decl.platform === 'web'` (`:761-763`). A package that is not a Loader entry resolves to no client row (`:747-753`).

### 2.4 Real contributed-slot example: `ui-open-in-app`

`packages/client/ui-open-in-app/package.json` (excerpt):
```json
"exports": {
  ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
  "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
  …
},
"dsh": {
  "client": {
    "inject": [
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-conversation",
      "@deepseek-ai/dsh-client-ui-renderer",
      "@deepseek-ai/dsh-client-ui-session"
    ],
    "platform": "web"
  }
}
```
`packages/client/ui-open-in-app/src/client/index.ts:28-51` (verbatim, `inject` at line 28, `apply` at line 34):
```ts
/** Required services for locale registration and the header-slot contribution. */
export const inject = ['sessions', 'slots', 'locale']

/** Client plugin body: register the dictionaries and the header split button. */
export function apply(ctx: ClientContext): void {
  const controller = new OpenInAppController()
  void controller.load()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'open-in-app: dictionaries')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'open-in-app',
    order: -10,
    locale: NS,
    inject: (): OpenInAppActionInjected => ({
      hooks: {
        openInAppApps: controller.apps,
        openInAppChoice: controller.choice,
      },
      launch: (appId, path) => controller.launch(appId, path),
      choose: (appId) => { controller.choose(appId) },
      iconUrl: appId => `${OPEN_IN_APP_ICON_PREFIX}/${appId}`,
    }),
  }, OpenInAppAction))
}
```
Note the two different `inject`s: the manifest list is **informational package edges**; the source `inject` is the
Cordis service list (`packages/client/AGENTS.md`, restated in `client-half-build-contract.md`).

### 2.5 What a browser half may import (module table)

- Baseline frozen module-table rows — `packages/client/web/src/platform.ts:8-15`:
  `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`,
  `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`,
  `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit`.
  `PRELOADED_CLIENT_EXTERNALS` is empty.
- Any other cross-package **value** import is a build error unless declared in `dsh.client.external`
  (purity gate `packages/client/tsdown.client.ts`, plugin `dsh-client-bundle-purity`), or it matches the inline-safe
  wire-layer regex (`INLINE_SAFE`, incl. `dsh-typert-protocol`, `dsh-util-workspace-path`) or the generated
  `@deepseek-ai/dsh-<pkg>/remote` regex (`GENERATED_REMOTE`).
- Requesting `<pkg>/client` resolves to that package's module-table row: `stripClientSuffix`
  (`packages/client/modules/src/client/manifest.ts:156-158`) is applied by the loader's `require`/`import`
  (`modules/src/client/system.ts:200-229`). Only two in-tree packages use `external`
  (`api/session-controller`, `api/workspace-controller`, both `["@deepseek-ai/dsh-api-gateway/client"]`).

## 3. Host → browser data

### 3.1 Path A — typert Remote namespace (typed RPC + streams); the canonical one

Host half (`docs/cookbook/adding-a-remote-api.md:9-48`):
extend `TypertRemoteService`, mark methods `@Remote('name')`, keep `signal: AbortSignal` last, publish the generated
`./typert` artifact. Registration into the runtime registry is done either by mounting
`@deepseek-ai/dsh-typert-registry` + `@deepseek-ai/dsh-typert-loader` in the host composition (the loader
auto-discovers every Loader entry's `./typert` export; `packages/typert/loader/README.md`), or directly:
`ctx.typert.register(contribution)` (`packages/typert/registry/README.md`, "Registering a contribution").
Decorator + base class: `packages/typert/protocol/src/index.ts:141-172` (`bindTypertRemote`, `TypertRemoteService`)
and `:174-224` (`Remote` overloads, `{ mode: 'stream' }`).

Manifest for a package that also has Remote methods — `packages/client/file-upload/package.json`:
```json
"./typert": { "types": "./lib/typert.host.d.ts", "default": "./lib/typert.host.js" },
"./remote": { "types": "./lib/typert.remote-client.d.ts", "default": "./lib/typert.remote-client.js" }
```

Client half:
- generated client projection of the host contract, e.g. `packages/api/workspace-files/lib/typert.remote-client.d.ts:11-24`:
  `read: (workspaceFileScopeId: SessionId, path: string, range: WorkspaceFileRange, signal?: AbortSignal) => Promise<RemoteResult<WorkspaceFileText>>`
  and `changes: (…) => AsyncIterable<WorkspaceFileWatchFrame>` for `mode: 'stream'`.
- mount it in the caller's own fiber: `ctx.remote.$mount(contribution): Promise<TypertDisposer>`
  (`packages/api/gateway/src/client/index.ts:201-208`; interface `packages/typert/protocol/src/types.ts:306-324`).
- call it: `const r = await ctx.remote.<namespace>.<method>(...)`; `RemoteResult<T> = {ok:true,value} | {ok:false,error}`
  (`typert/protocol/src/types.ts:74-76`); inject both `'remote'` and `'remote.<namespace>'`
  (`adding-a-remote-api.md:107-118`).
- Worked self-mount example (the pattern an out-of-tree plugin must use, since the in-tree client assembly hardcodes its
  namespace list): `packages/experimental/client-ui-agent-team/src/client/index.ts:1-14` imports
  `agentTeamsRemote from '@deepseek-ai/dsh-experimental-agent-team/remote'` and
  `mount.ts:84-96` does `const disposeRemote = await ctx.remote.$mount(contribution)` before registering its UI.
  The in-tree alternative is the closed list in `packages/api/remotes/src/client/index.ts:153-159`.

Constraints: args/results are JSON — exact arg fields checked against the descriptor
(`gateway/src/index.ts:1107-1132`), JSON-safety checked (`assertJsonValue` `:1159+`), codecs strict zod or `src-json`
(`typert/protocol/src/types.ts:221-230`); failures cross the wire as `RemoteError` values, never rejections;
cancellation is the trailing `AbortSignal` (`gateway/cancelled`); endpoint segments must match `/^[A-Za-z0-9_$.-]+$/`
(`typert/protocol/src/index.ts:13-21`); the host service must be live and its `typertRemote` binding must match the
descriptor (`validateBinding`, `gateway/src/index.ts:1016+`), i.e. use `TypertRemoteService`/`bindTypertRemote`.
Producing the generated `/remote` artifact needs the published build-time generator `@deepseek-ai/dsh-typert-generator`
(`publishConfig.access: public`; `./tsdown` subpath exporting `typertPlugin()`); without generation, use Path B.
The client bundle may inline its own generated `/remote` module (`GENERATED_REMOTE` in
`packages/client/tsdown.client.ts`).

### 3.2 Path B — plain HTTP route + same-origin fetch (no code generation)

- Host: `ctx.webServer.register({ kind: 'exact' | 'prefix', path, handler })`
  (`packages/host/webserver/src/index.ts:38-48`; service name fixed at `:144` `super(ctx, 'webServer')`;
  `Context.webServer` merged at `:22-25`).
- Worked example: `packages/host/open-in-app/src/index.ts:193-204` (GET apps route) and `:241+` (POST open route),
  each guarded by `ctx.connection.requestRejection(req)` (trust fence helper `:185-192`).
- Browser: same-origin `fetch` against the route — `packages/client/ui-open-in-app/src/client/controller.ts:10-16`
  (`hostBase()` with a `http://dsh.internal` fallback) and `:34-45` (`load()`).
- Limit: untyped JSON, manual validation on both ends; no streaming helper beyond what the handler does itself.

### 3.3 Path C — reuse the mounted `workspaceFiles` namespace

Any client plugin can inject `remote.workspaceFiles` (it is mounted by `dsh-api-workspace-files`, see the inject list in
`ui-sidebar-documentpreview/src/client/index.ts:79`) and read file text/bytes/related assets with no host code of its
own: `workspaceFiles.read | readAll | readBytes | readRelated | stat | list | changes`
(`packages/api/workspace-files/lib/typert.remote-client.d.ts:11-24`); the preview viewer contract already hands content
to viewers, so a pure viewer needs none of this.

### 3.4 Closed channel — forwarded Cordis events

`ctx.remote.$on(event, listener)` exists (`typert/protocol/src/types.ts:314-323`) but the legal event set is a fixed
allowlist hardcoded in the in-tree assembly: `packages/api/remotes/src/remote-events.ts:17-38` (19 events) registered via
`ctx.typertGateway.registerRemoteEvents(remoteEventSource(ctx), …)` (`api/remotes/src/index.ts:36-44`).
A third-party plugin cannot add an event without patching that package.

### 3.5 Fixed host facts

`ctx.remote.$host` → `{ home: string | undefined, isLoopback: boolean }`, plain reads, no subscription
(`packages/api/gateway/src/client/index.ts:102-118` for the `ClientRemote` face, `get $host()` `:190-198`).

## 4. Two plugins in the same slot — conflicts and order

`SlotCore.register` (`packages/client/ui-slots/src/index.ts:826-935`) is the authority:

- **Keyed**: registration requires `key` (`:845`); a second entry with the same `key` at the same priority
  (default 0) **throws** naming the occupant (`:846-850`); a lower `priority` **shadows** — "lowest renders" (`:836-837`).
- **Single**: a second registration at the same priority throws (`:839-842`); different priority shadows.
- **List**: requires `id` (`:853`); same `id` + same priority throws; entries sort by `priority` then `order` (`:905-907`).
- **Chain**: requires `select` (`:861`); all entries stay; selectors run in ascending `priority`, ties in registration
  order, first non-null elects (`ui-slots/src/index.ts:259-270`).
- Effective occupants: `entriesOfSlot` returns the first live entry per cell (`:975-991`).
- A crashed entry can abdicate its cell (`reportEntryError` `:1137-1145`), letting the next survivor render.
- For document viewers specifically: `matchingDocumentPreviews` ranking (§1.6) is the tie-break, and
  `DocumentPreviewRegistry.register` refuses duplicate ids outright.
- For Sidebar tab types: `SidebarRightTabRegistry.register` (`ui-sidebar-right/src/client/tab-registry.ts:242-268`) throws
  on a duplicate `id`; one kind holds at most one `extension` **and** one `builtin` simultaneously
  (`coexists` `:170-172`), the `extension` is in force and the builtin resumes when it unregisters
  (`enter`/`leave` `:270-297`); `fallback` shares a kind with nothing. Ranking of address candidates:
  band rank (`extension` 3 > `builtin` 2 > `fallback` 1, `:51-55`), then longest matched pattern, then registration order
  (`candidates` `:337-351`). Default band for a definition that names none is `extension` (`:58`).

## 5. Not found / not covered (searched, with what)

- **No manifest-level slot or viewer declaration.** `dsh.client` accepts only the four fields above; `parseDshClient`
  ignores unknown keys. Searched: `packages/util/package-manifest/src/**`, `packages/client/modules/src/index.ts`,
  `grep -rn '"slots"' --include=package.json packages/ apps/` (no hit).
- **No host-side document-viewer extension point**: the package's host `apply` is empty and its host entry exports
  nothing else.
- **No supported way for an out-of-tree plugin to extend the forwarded-event allowlist or the `api-remotes` client
  namespace list** — both are in-tree source lists (`api/remotes/src/remote-events.ts`,
  `api/remotes/src/client/index.ts:153-159`). Workaround: self-mount via `ctx.remote.$mount` (proven in-tree by
  `experimental/client-ui-agent-team`).
- **Not verified (out of scope of this read):** whether the profile/launcher code automatically makes every installed
  out-of-tree package a host Loader entry (which the client-modules scanner requires). Searched only the DSH-side
  mechanics (`modules/src/index.ts:743-778`, `resolveMeta`), not `apps/cli` profile code.
- **Not found:** any public API that registers a slot *declaration* without owning the render site, or any way to
  register a second declarer for `sidebar.right.tab.document`.

## 6. Minimal recipe — one out-of-tree package with both halves, adding a document viewer

1. `package.json`: host half exports `.`; browser half exports `./client`; declare
   `"dsh": { "client": { "platform": "web" } }`. The package must be a host Loader entry (profile config tree) for the
   browser half to be served (`packages/client/modules/src/index.ts:743-778`).
2. Host `src/index.ts`: `export function apply(): void {}` (or host services, see §3).
3. Browser `src/client/index.ts`:
   ```ts
   import type {} from '@deepseek-ai/dsh-client-ui-slots'
   import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
   import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'  // brings the SlotMap merge
   import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'

   export const inject = ['slots', 'documentPreviews']   // plus 'locale' if you register copy

   const ID = '<npm-package-name>/viewer'
   export function apply(ctx: Context): void {
     ctx.effect(() => ctx.documentPreviews.register({
       id: ID, extensions: ['xyz'], priority: 'extension',
       title: () => 'XYZ viewer', loading: 'bytes-complete', wrap: false,
     }))
     ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
       { name: 'sidebar.right.tab.document', key: ID }, Body,
     )))
   }
   ```
   `Body({ content, resourceAddress, wrap, scrollportRef, useTabInfo, useResource }: DocumentPreviewProps)`.
4. Build the browser bundle with the closure-factory contract (`window.__ModuleLoader__.load({id, factory})`, CJS,
   `lib/client.js`) — see `client-half-build-contract.md`; `tsdown` + `packages/client/tsdown.client.ts` is the in-tree
   preset, and `@deepseek-ai/dsh-typert-generator/tsdown` is needed only for Path A RPC.
5. Do **not** declare `sidebar.right.tab.document`, do not reuse another plugin's `id`, and do not import another
   client plugin as a value unless it is in the baseline list or declared in `dsh.client.external`.
