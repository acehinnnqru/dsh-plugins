# dsh-plugin-now

A DSH plugin with both halves: a host half that registers one `now` tool, so the model answers time
questions from the host clock instead of guessing, and a browser half that puts a live clock in the
Web GUI's sidebar footer. It is also the repo's reference plugin: copy this directory when starting a
real one.

## What it does

Host half (`lib/index.js`, from `src/index.ts`):

- Registers a single model-facing tool, `now`.
- `now()` returns an ISO-8601 UTC timestamp.
- `now({ format: 'human' })` renders the deployment's configured time zone instead.
- Writes one line through `ctx.logger` when it loads: `now: registering the now tool (timeZone=…)`.

Browser half (`lib/client.js`, from `src/client/index.tsx`):

- Registers one entry in the sidebar footer (`sidebar.footer.action`, `id: now-clock`).
- It shows the **browser's** local wall clock, redrawn every second; clicking it copies an ISO-8601
  UTC timestamp — the same string the `now` tool returns. The browser's time zone is not the host's
  configured `timeZone`: the two halves share no data, and this plugin deliberately needs no
  host→browser path.
- The 56px sidebar rail shows the time without the date. `clockLabel()` decides that, and it is pure,
  so `tests/format.spec.ts` asserts the visible text without a DOM.

It registers nothing else: no services, no session events, no Remote namespace.

That logger line is diagnostics, not startup output: cordis accepts `ctx.logger` messages but only
fills a ring buffer unless the deployment mounts an exporter, and no shipped DSH profile mounts one,
so it appears on no terminal. To confirm the plugin loaded, open Settings → Plugin list in the Web UI
— the row's Status reads Running / Waiting for dependencies / Failed to start — or look for the clock
in the sidebar footer.
[`docs/install.md`](../../docs/install.md#where-startup-output-goes) has the details.

## The two halves, and why a UI plugin still needs the host one

| | Host half | Browser half |
|---|---|---|
| Entry | `src/index.ts` → `lib/index.js` | `src/client/index.tsx` → `lib/client.js` |
| Declared by | `dsh.bundle.patch` (the Loader row) | `dsh.client.platform: 'web'` + `exports["./client"]` |
| Waits for | `ctx.tools` | the `slots` Cordis service |
| Loaded by | the host Loader, from the profile's config tree | the Web client, as a plain `<script>` |

The browser module graph is built from **live host Loader rows**, so a browser-only package has no way
into it: the host half is what puts the row in the config tree, and the browser half hangs off that
row. An empty `apply` would be enough here; this one registers a tool.

The two `inject` lists are different things: `export const inject = ['slots']` in the source is a
**Cordis service** list and decides when the half loads, while `dsh.client.inject` in `package.json`
is an informational **package name** list and decides nothing.

## Install into a profile

Build first — the profile installs `lib/index.js` and `lib/client.js`, and a `link:`/path install
serves those files straight from this directory. Run this from the repo root:

```sh
pnpm --filter dsh-plugin-now build
dsh plugin --profile dev add "$PWD/plugins/now"
dsh --profile dev --dump-config | grep -A3 'dsh-plugin-now'   # the layer is in the composed config
dsh --profile dev
```

`dsh` lives only in the maintainer's environment (DSH checkout); nothing in this repo
calls it. The full checklist, including how to change the config and uninstall, is
[`docs/install.md`](../../docs/install.md).

## Development loop

```sh
# terminal A, in this repo
pnpm --filter dsh-plugin-now watch

# terminal B, in the maintainer's environment
dsh --profile dev
```

Edit `src/client/` → `tsc -b --watch` republishes `lib/types/` → `tsdown --watch` rewrites
`lib/client.js` → the host notices the file changed and the browser swaps the plugin in. No restart.

Two things worth knowing:

- The watcher bundles what `tsc` emits, so it needs one `pnpm --filter dsh-plugin-now build` first; it
  does not bootstrap a missing `lib/`.
- Only the artifact is picked up automatically. A change to `package.json` (the `files` list, the
  `exports` map, `dsh.client`) or to `cordis.patch.yml` means installing the plugin into the profile
  again.

## Configuration and safety

The profile layer is `cordis.patch.yml`; a later layer (the profile's own patch, the home patch, or
`--patch`) overrides the row by id. Overriding `config` replaces the whole object — there is no deep
merge, so restate every key you still want.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `timeZone` | `string` | `'UTC'` (the schema default; the bundled patch sets `Asia/Shanghai`) | IANA time zone name used by `format: 'human'`, for example `Asia/Shanghai`. |

Safety: the host half reads the host clock and the resolved config, and nothing else. It makes no
network requests, touches no files, and holds no credentials. Like every DSH plugin it runs in the
host process with the host's privileges — the tool body is the only code it adds, and that code
formats a `Date`.

The browser half reads the browser clock and writes to the clipboard when clicked. It imports only
`react` (a frozen baseline module of the shell's module table) and its own stylesheet, talks to no
host route, and holds no state beyond the current second.
