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
  - **Completed** — the turn finished and that completion has not been read. The board also catches a
    stop DSH leaves unmarked because the Session stayed `mainView`-retained behind this panel.
- Omits idle Sessions, Sessions whose completion has already been read, blank drafts, subagent-origin
  rows, and archived Sessions. A **Waiting for input** card opens a dialog that surfaces the native
  question immediately; every other card opens a full-screen preview **inside this page**. The
  native Conversation, including its composer and any question/approval takeover, renders in either
  surface. The dialog's **Full conversation** action expands to the page, and the page's back bar
  returns to the board.
- Embeds the native Conversation through the shared `conversation.content` Factory — the same host
  the subagent right-Sidebar chat uses — with a `SessionProvider` bound to a retained Session
  reference. It does not navigate, does not replace the main Conversation panel, and releases the
  reference when the preview closes.
- Reads only the live client state DSH already publishes — the Session list, the unified Session
  status, and the Workspace archive set — so the board follows running state, pending interactions,
  and reads without polling or a host route. **Completed** combines DSH's own unread-completion
  marker with a running→stopped edge the plugin observes globally. A stop counts unless that Session
  is the visible conversation (conversation selected and retained as `mainView`): DSH leaves its own
  marker false when the Session stays `mainView`-retained behind a global panel, which is exactly
  the board's situation.
- Opening a card that is already in **Completed** marks that completion read: the card is hidden
  until a newer stop or the Session's summary `updatedAt` advances. Only that click acknowledges a
  completion; a **Running** Session that finishes while its preview or the question dialog is open
  still appears in **Completed** when you return. Both the read mark and the local stop note are
  browser-local and reset with the page.
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
archive set from the Workspace Controller. Opening a card retains one Session reference and renders
the native Conversation through the `conversation.content` Factory; closing the preview releases
the reference. The board itself never starts, stops, renames, or archives a Session; the embedded
native composer is the Session's own input surface, used by the person in front of it. Nothing is
persisted beyond the in-memory preview mark, which resets with the page.

## How the columns are decided

`src/client/board.ts` is the pure classification step:

1. Keep only ordinary, non-blank, non-archived rows from the Session list.
2. A `pendingInteraction` puts the Session in **Waiting for input**.
3. Otherwise a running turn puts it in **Running**. Until the status snapshot knows the row, the
   list row's own running flag is the fallback, matching the Workspace row.
4. Otherwise `completionUnread`, or a stop this plugin observed, puts it in **Completed**.
5. A completion whose card was opened from **Completed** is omitted until a newer stop or the
   Session's summary `updatedAt` advances; that mark is local and does not change DSH's own state.
6. Everything else is omitted, which is what makes a read Session disappear.

`tests/board.spec.ts` covers the precedence, the filters, the preview mark, and the surface
choice; `tests/conversation-input.spec.ts` covers the embedded Factory phase; `tests/client.spec.ts`
executes the built bundle and checks its registrations, baseline imports, CSS, and source map.
