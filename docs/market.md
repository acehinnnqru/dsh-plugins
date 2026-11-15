# Using this repo as a plugin market index

DSH 0.2.2-rc.3 ships the experimental `@deepseek-ai/dsh-experimental-plugin-market-bundle`: a
**Discover** tab on the Plugins page that reads static **plugin market indexes** and installs the
bundles they list. This repo produces one index, `index.json` (generated; see below), so its
plugins can be browsed and installed from that tab instead of by copying a path or a tarball.

The format is defined by the upstream note
`.agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.md` and implemented by
`@deepseek-ai/dsh-plugin-market-index`. The generator here is `tooling/market-index`; it validates
its output with that package before writing anything.

## What the market needs from a plugin

| Requirement | Where it is satisfied |
|---|---|
| The package declares `dsh.bundle.patch` | Every `plugins/<name>/package.json` already did |
| The package is not `private: true` | Removed from every plugin manifest (the reference generator skips private packages) |
| A Git install can produce `lib/` | Each plugin has `"prepare": "tsc -b tsconfig.json && tsdown"` and the build devDependencies (`typescript`, `tsdown`, `@types/node`). `lib/` stays gitignored |
| `engines.dsh` is a valid range | Derived from the plugin's `@deepseek-ai/dsh*` peer ranges (all `0.2.2-rc.3`); an explicit `engines.dsh` in the manifest wins |
| One exact version, one pinned source | `index.json` lists `version` and a `source` of `git` + `commit` + `path` |

The index makes the repo **installable over Git**, not published to a registry. `private` was only
removed because the market's reference generator treats it as "do not distribute"; nothing in this
repo publishes to npm.

## Generate the index

From the repo root:

```sh
pnpm market:index
pnpm verify:market
```

`market:index` reads **the commit**, not the working tree. Commit and push the plugin changes first;
the default is `HEAD`, and the index names that commit in every version. It refuses to write when the
commit is not on a remote-tracking branch, because pnpm could not fetch it. Uncommitted changes are
reported as a warning, not silently included.

| Option | Meaning |
|---|---|
| `--commit <ref>` | Pin another commit-ish (for example an earlier release) |
| `--out <file>` | Write somewhere other than `index.json` |
| `--repo-url <url>` | Override the canonical repository URL; the default is `remote.origin.url` |
| `--title`, `--description` | English index title and description |
| `--author <name>` | Author shown when a plugin manifest declares none; the default is `git config user.name` |
| `--allow-unpushed` | Write the index even when the commit is not on a remote-tracking branch (the default refuses) |

A manifest is skipped, with a warning, when it is private, has no `dsh.bundle.patch`, names a patch
file the commit does not contain, declares no DSH range, or has a version that is not exact SemVer.
Review the warnings: a skipped plugin does not appear in Discover.

The index is a release artifact and lags the branch by at least one commit, because a commit cannot
contain its own SHA. After every push that changes a plugin, rerun `market:index` and commit the
updated index.

## Host the index

The market fetches the index with a plain HTTP(S) request, refuses redirects, and sends no
credentials. The index URL must answer directly.

- **Public GitHub repository** — the raw URL works:
  `https://raw.githubusercontent.com/acehinnnqru/dsh-plugins/main/index.json`
- **This repository is private**, so that URL answers 404. Serve the file yourself over HTTP(S)
  from any static host. For a local-only setup, run this in the repo root and leave it running:
  ```sh
  python3 -m http.server 8765 --bind 127.0.0.1
  ```
  Then use `http://127.0.0.1:8765/index.json` as the index source.

The private Git **source** is separate: pnpm resolves `https://github.com/acehinnnqru/dsh-plugins`
through your SSH keys or credential helper, and rewrites it to `git+ssh` when needed. The index file
itself still has to be readable without credentials.

## Add it in DSH

1. Open **Plugins** and switch on **Custom plugin indexes** under **Experimental plugins**. The
   **Discover** tab appears.
2. **Discover → Add index source**, paste the URL above, and select the index.
3. Pick a plugin and press **Install**. The profile gets a dependency on
   `git+https://github.com/acehinnnqru/dsh-plugins.git#<commit>&path:/plugins/<name>`.

### The build approval

`lib/` is not committed, so the Git install has to build it. pnpm runs the plugin's `prepare` script
for a Git dependency, and pnpm 11 blocks that script until it is allowed:

- DSH reports the pending `allowBuilds` key and offers **Allow these scripts and retry** on the
  Plugins page (the same choice is `approvedBuilds` on the `plugin_manager` tool for an agent).
- Approving records the exact Git URL and commit. The script runs with your user's permissions and
  installs the plugin's devDependencies from the registry, so it needs network access.

This is the expected cost of a Git source. A tarball install has the same build already inside
`lib/`; it needs no approval because no script runs.

## Updating a plugin

The market has no upgrade action. To move to a newer commit:

1. Push the plugin change.
2. Rerun `pnpm market:index` and commit/host the result.
3. Remove the installed bundle and install it again from Discover.

The plugin versions are `0.0.0` today. Version numbers are displayed and compared, but a Git source
is pinned by commit; bumping the version is what lets DSH report `update-available` rather than
`installed` after a new commit.

## What `verify:market` checks

`pnpm verify:market` parses the committed index with `@deepseek-ai/dsh-plugin-market-index` and then,
for every listed version:

- resolves the pinned commit locally;
- reads `package.json` at that commit and checks name, version, `private`, `dsh.bundle.patch`, and
  the patch files;
- compares `engines.dsh` with the manifest's derived range;
- compares `publishTimestamp` with the commit's committer time;
- warns when the commit is not on a remote-tracking branch.

It deliberately does not require the index to point at `HEAD`: an index is allowed to lag the branch.

## Security

A market index is unsigned. Its title, author, description, and version are claims; the installed
manifest and pinned commit are what actually run. Only serve an index you generated, and check the
source URL and commit before approving a build.

## Files

| Path | Role |
|---|---|
| `index.json` | The generated format-1 index (commit it after generating) |
| `tooling/market-index/src/index.ts` | Build and verify logic |
| `tooling/market-index/tests/market-index.spec.ts` | Fixture repositories, validator round trip, drift checks |
| `scripts/market-index.ts` | CLI for `pnpm market:index` and `pnpm verify:market` |
