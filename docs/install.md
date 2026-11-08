# Installing a plugin into a DSH profile

`dsh plugin --profile <name> …` is a thin pnpm forwarder: it creates `$DSH_HOME/profiles/<name>` if
it does not exist, runs pnpm inside it, and then re-reads the profile's dependencies — every one that
declares `dsh.bundle.patch` becomes a profile layer, every one that does not gets a warning.

Nothing in this repo runs `dsh`. It exists only in the maintainer's environment (DSH checkout + nix
devshell + npx), so this page is a manual checklist: copy, paste, compare. `dsh-plugin-now` is the
example throughout.

## 0. Build and pack it first

```sh
cd /Users/rqc/r/github.com/acehinnnqru/dsh-plugins
direnv exec . pnpm install                              # once per clone
direnv exec . pnpm --filter dsh-plugin-now build
direnv exec . pnpm --filter dsh-plugin-now pack --pack-destination /tmp/dsh-plugin-pkg
```

`--pack-destination` creates the directory itself, so there is no `mkdir` step.

**The acceptance install is the tarball, not the source directory.** A tarball is copied into the
profile and resolves its dependencies exactly like a real install; a path install is a `link:` whose
real path stays in this repo, so the plugin resolves its peers from here instead of from the profile
([DESIGN.md](../DESIGN.md) §3.5). The path install is still the fast everyday loop:

```sh
dsh plugin --profile demo add /Users/rqc/r/github.com/acehinnnqru/dsh-plugins/plugins/now
dsh plugin --profile demo add /tmp/dsh-plugin-pkg/dsh-plugin-now-0.0.0.tgz
```

The first one is `link:`: pnpm copies nothing and does not install the plugin's own dependencies —
they come from this repo's `node_modules`, which is why `pnpm install` has to have run here. The
second one installs them into the profile.

## 1. Create a profile to demo in

Optional, but it keeps the demo out of the profile your GUI is already served from. The shipped `web`
template is `dsh-base` + `dsh-web-app`:

```sh
dsh --profile demo --from-default-profile web --dump-config > /dev/null
```

`--from-default-profile` only applies while the profile directory does not exist yet, so run this
before anything else touches `demo`. If the dump itself errors on the brand-new profile (nothing has
been installed into it yet), the directory has already been created from the template — repeat the
dump after step 2. Skipping this step is fine too: `dsh plugin --profile demo add` would then
initialize `demo` from the plain default, which is `dsh-base` alone.

## 2. Add the plugin

```sh
dsh plugin --profile demo add /tmp/dsh-plugin-pkg/dsh-plugin-now-0.0.0.tgz
```

Expected: pnpm reports `dsh-plugin-now` added, and the profile's `package.json` gains
`"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",
"dsh-plugin-now"] } }`. If `dsh-plugin-now` is missing from `bundles`, the install resolved a
manifest without `dsh.bundle.patch` — the plugin would load as an ordinary dependency and activate no
config layer.

## 3. Check the layer without booting

```sh
dsh --profile demo --dump-config | grep -B3 -A6 'dsh-plugin-now'
```

Expected: one row with `name: 'dsh-plugin-now'`, `id: now`, and the config from the plugin's own
`cordis.patch.yml` (`timeZone: Asia/Shanghai`). This runs before any boot, so it separates the two
failure classes: no row means a config/layer problem, a row that never loads means a code problem.

## 4. Boot it

```sh
dsh --profile demo              # serves the Web UI on the default port 3080
dsh --profile demo --port 3099  # …or beside a GUI that already owns 3080
```

`--port` and `--no-open` belong to the web app; the launcher passes everything it does not recognize
through to it.

Expected: the Web UI answers on that port. A successful boot prints nothing to the terminal — see
[Where startup output goes](#where-startup-output-goes). Failures do print, as `dsh: …` lines on
stderr.

## 5. Confirm the plugin loaded

Two places, in this order:

1. **Settings → Plugin list** in the Web UI. Find the row whose Module is
   `dsh-plugin-now`; its Status reads Running / Waiting for dependencies / Failed to start, next to
   its Configuration state. A row that is missing entirely never got into the composed tree — go back
   to step 3.
2. **The tool call itself**: ask the model *what time is it?* It should call `now` (and
   `now({ format: 'human' })` when you ask for local time), and the answer comes from the host clock.
   This is the only proof that the code, not just the row, is live.

## 6. Change the config

The plugin row can be overridden by any later layer — the profile's own patch
(`$DSH_HOME/profiles/demo/cordis.patch.yml`), `$DSH_HOME/cordis.patch.yml`, or `--patch <file>`:

```yaml
- id: now
  config:
    timeZone: 'Europe/Berlin'
```

Overriding `config` replaces the whole object: restate every key the row still needs. A profile whose
`dsh.profile.patchReload` is `live` picks this up without a restart; a bundle **install** does not —
the bundle set is read at startup, so adding or removing a plugin needs a restart.

## 7. Remove it

```sh
dsh plugin --profile demo remove dsh-plugin-now
```

The row disappears from `bundles`, and the plugin stops loading on the next start.

## Where startup output goes

There are three surfaces, and only the first one is a terminal:

| Surface | What reaches it |
|---|---|
| **stderr of the `dsh` process** | Launcher diagnostics only, each line prefixed `dsh: ` — `.env` layering problems, proxy notices, patch entries that matched no target, and boot failures with their stack. A **successful** boot writes nothing here. |
| **`ctx.logger.*` inside a plugin** | Nothing. Cordis's `LoggerService` always exists and always accepts messages, but with no exporter mounted it only fills a 1000-message ring buffer, and no shipped DSH profile mounts one — the only `ctx.logger.exporter()` call in the whole upstream tree is the experimental webworker runtime, and it forwards warnings and errors only. |
| **Settings → Plugin list** in the Web UI | The runtime truth: every row's module name, enabled flag, configuration state, and fiber phase (Running / Waiting for dependencies / Failed to start). This is where a plugin that failed to load actually becomes visible. |

So a plugin's own load message is not how you confirm it loaded. Use the plugin list, and then the
tool call. If you positively want a line on the terminal from a plugin, it has to write to
`process.stderr` itself — upstream avoids that for info-level logging precisely because a full
profile has over a hundred rows.

Two useful non-runtime checks, for narrowing a failure:

```sh
dsh --profile demo --dump-config | grep -B3 -A6 'dsh-plugin-now'   # is the row composed at all?
dsh --profile demo --dump-config | tail -20                        # what did the launcher warn about?
```

## Notes

- Profile directories live under `$DSH_HOME/profiles/` (default `~/.dsh`). They are not part of this
  repo and are never committed.
- The plugin's peer dependencies (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`) are deliberately
  not installed into the profile: the profile sets `autoInstallPeers: false`, so they resolve from
  the DSH installation's own closure. That is what keeps one Cordis instance in the process.
- The two install kinds resolve those packages from different trees, and that is measured, not
  assumed. A throwaway profile carrying this profile's own settings (`nodeLinker: hoisted`,
  `autoInstallPeers: false`) shows it: with `link:`, `import.meta.resolve('@deepseek-ai/cordis')`
  answers from **this repo** (`…/dsh-plugins/node_modules/.pnpm/@deepseek-ai+cordis@4.1.0_@deepseek-ai+cordis-plugin-include@1.1.0_@deepseek-ai+cordis-plugin-loader@1.1.0/…`); with a
  tarball, the peers are not in the profile at all — that is what `autoInstallPeers: false` does —
  and fall through to the installation's `profiles/node_modules` closure. Same version, different
  physical path. This plugin only imports functions and types, so both behave identically; a plugin
  that depends on module identity (extending `Service`, say) has to be accepted through a tarball
  ([DESIGN.md](../DESIGN.md) §3.5). To close [DESIGN.md](../DESIGN.md) §5 V1, add this to `apply`,
  rebuild (`direnv exec . pnpm --filter dsh-plugin-now build`), and boot once per install:

  ```ts
  console.log('[probe] cordis =', import.meta.resolve('@deepseek-ai/cordis'))
  ```

  It has to be a raw `console.log`: `ctx.logger` reaches nothing (see above). Record the two paths
  here, then delete the line.
