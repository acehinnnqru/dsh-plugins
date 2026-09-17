# dsh-plugin-now

A host-half DSH plugin that registers one `now` tool, so the model answers time questions from the
host clock instead of guessing. It is also the repo's reference plugin: copy this directory when
starting a real one.

## What it does

- Registers a single model-facing tool, `now`.
- `now()` returns an ISO-8601 UTC timestamp.
- `now({ format: 'human' })` renders the deployment's configured time zone instead.
- Writes one line through `ctx.logger` when it loads: `now: registering the now tool (timeZone=…)`.

It registers nothing else: no services, no session events, no browser half.

That logger line is diagnostics, not startup output: cordis accepts `ctx.logger` messages but only
fills a ring buffer unless the deployment mounts an exporter, and no shipped DSH profile mounts one,
so it appears on no terminal. To confirm the plugin loaded, open Settings → Plugin list in the Web UI
— the row's Status reads Running / Waiting for dependencies / Failed to start — or ask the model for
the time and watch for the `now` tool call.
[`docs/install.md`](../../docs/install.md#where-startup-output-goes) has the details.

## Install into a profile

Build first — the profile installs `lib/index.js`, and a `link:`/path install serves that file
straight from this directory:

```sh
direnv exec . pnpm --filter dsh-plugin-now build
dsh plugin --profile dev add /Users/rqc/r/github.com/acehinnnqru/dsh-plugins/plugins/now
dsh --profile dev --dump-config | grep -A3 'dsh-plugin-now'   # the layer is in the composed config
dsh --profile dev
```

`dsh` lives only in the maintainer's environment (DSH checkout + nix devshell); nothing in this repo
calls it. The full checklist, including how to change the config and uninstall, is
[`docs/install.md`](../../docs/install.md).

## Configuration and safety

The profile layer is `cordis.patch.yml`; a later layer (the profile's own patch, the home patch, or
`--patch`) overrides the row by id. Overriding `config` replaces the whole object — there is no deep
merge, so restate every key you still want.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `timeZone` | `string` | `'UTC'` (the schema default; the bundled patch sets `Asia/Shanghai`) | IANA time zone name used by `format: 'human'`, for example `Asia/Shanghai`. |

Safety: the plugin reads the host clock and the resolved config, and nothing else. It makes no
network requests, touches no files, and holds no credentials. Like every DSH plugin it runs in the
host process with the host's privileges — the tool body is the only code it adds, and that code
formats a `Date`.
