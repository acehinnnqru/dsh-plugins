# dsh-plugin-session-manager

A sidebar entry and a main-column board that show the Sessions which currently need attention, grouped
by runtime state.

## What it does

- Adds one row to the sidebar's global panel list, after Plugins and Automation tasks. Selecting it
  opens the board in the main column. The product owns the row button, its label, and its selected
  state; this plugin contributes the icon and the page behind the row.
- Draws three columns: **Running**, **Waiting for input**, and **Completed**.
  - **Running** — the Session's turn is executing and no domain is waiting for the user.
  - **Waiting for input** — a pending interaction outranks a running turn. The card says whether it
    is an approval, a plan review, an ordinary question, or an unrecognized domain.
  - **Completed** — the turn finished while the Session was not in the main view, and that completion
    has not been read yet.
- Omits idle Sessions, Sessions whose completion has already been read, blank drafts, subagent-origin
  rows, and archived Sessions. Opening a card is the read acknowledgement: it navigates to that
  Session and the card leaves the board.
- Reads only the live client state DSH already publishes — the Session list, the unified Session
  status, and the Workspace archive set — so the board follows running state, pending interactions,
  and reads without polling or a host route. **Completed** uses DSH's own unread-completion marker:
  it is local viewing state, so a completion observed by this client stays unread until the Session
  is opened, and a reload never invents unread turns.
- Carries no host behavior. The host half is an empty `apply`; it exists because a browser half is
  attached to a live Loader row.

## Install into a profile

Build first — the profile installs `lib/index.js` and `lib/client.js`, and a `link:`/path install
serves those files straight from this directory:

```sh
direnv exec . pnpm --filter dsh-plugin-session-manager build
dsh plugin --profile <profile> add ./plugins/session-manager
```

`dsh` lives only in the maintainer's environment (DSH checkout + nix devshell); nothing in this repo
calls it. The full checklist is in [`docs/install.md`](../../docs/install.md).

## Development loop

```sh
# terminal A, in this repo
direnv exec . pnpm --filter dsh-plugin-session-manager watch

# terminal B, in the maintainer's environment
dsh --profile <profile>
```

Edit `src/client/` → `tsc -b --watch` republishes `lib/types/` → `tsdown --watch` rewrites
`lib/client.js` → the host notices the file changed and the browser swaps the plugin in. No restart.
The watcher needs one `pnpm --filter dsh-plugin-session-manager build` first; it does not bootstrap a
missing `lib/`. A change to `package.json` or `cordis.patch.yml` means installing the plugin again.

## Configuration and safety

The plugin has no profile options and no `Config` schema; `cordis.patch.yml` inserts one row and
nothing else. A later profile layer can still override that row by `id: session-manager`.

Safety: the host half registers nothing, reads nothing, writes nothing, and makes no network
requests. The browser half reads the Session list and unified UI status from the Web client, and the
archive set from the Workspace Controller; selecting a card calls the existing Session navigation
service. The board never starts, stops, renames, or archives a Session, and it persists nothing.

## How the columns are decided

`src/client/board.ts` is the pure classification step:

1. Keep only ordinary, non-blank, non-archived rows from the Session list.
2. A `pendingInteraction` puts the Session in **Waiting for input**.
3. Otherwise a running turn puts it in **Running**. Until the status snapshot knows the row, the
   list row's own running flag is the fallback, matching the Workspace row.
4. Otherwise `completionUnread` puts it in **Completed**.
5. Everything else is omitted, which is what makes a read Session disappear.

`tests/board.spec.ts` covers the precedence and the filters; `tests/client.spec.ts` executes the
built bundle and checks its registrations, baseline imports, CSS, and source map.
