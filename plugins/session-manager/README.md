# dsh-plugin-session-manager

A sidebar entry, a main-column board that keeps running, unread, and recent Sessions in view, a
management tab for batch archiving, a full-list session search, and a full-screen new-conversation
overlay that embeds the native composer.

## What it does

- Adds one row to the sidebar's global panel list, after Plugins and Automation tasks. Selecting it
  opens the page in the main column on the Board tab. The product owns the row button, its label, and
  its selected state; this plugin contributes the icon and the page behind the row.
- Draws three columns: **Running**, **Unread**, and **Recent**.
  - **Running** — the Session's turn is executing and no domain is waiting for the user.
  - **Unread** — a pending interaction or a completion that has not been acknowledged. A pending
    interaction outranks a running turn; the card says whether it is an approval, a plan review, an
    ordinary question, or an unrecognized domain, while a completion card says it is unread.
  - **Recent** — read and idle Sessions updated within the configured window (three days by default),
    newest first. A Session stays here after it leaves Unread, so it remains findable instead of
    disappearing.
- Omits blank drafts, subagent-origin rows, and archived Sessions. A **pending** card body opens a
  dialog that surfaces the native question immediately; every other card body opens the general
  session preview dialog. A separate hover/focus control on the card opens the **real Session page**,
  so the user's Conversation views and customizations stay intact. The pending dialog's **Full
  conversation** action still expands to the embedded page. The preview dialog's new-conversation
  control, beside **Open session**, starts the board's overlay in the previewed Session's Workspace
  under its Agent preset, then closes the preview.
- When the open-session control or the session dialog's **Open session** action opens the real page,
  a compact back control appears before the Session title and returns to the board; selecting any
  global panel clears it. The pending dialog keeps its own close control, and its expanded page keeps
  the back bar.
- Pins a Session from the icon that appears when its card is hovered or focused. Pinned Sessions move
  to a full-width **Pinned** rail above the columns and keep their runtime label there; the rail is
  absent until at least one pin exists. Pins are Host state shared with the native sidebar: the rail
  reads the registry-global pin set (newest pin first), and pinning or unpinning from either surface
  updates the other. The button only renders when the Session's access snapshot allows the action.
  The earlier browser-local pin list is no longer read.
- Starts a new conversation from the **New conversation** control in the page's top-right, or from
  the preview dialog's control beside **Open session**, which seeds the previewed Session's Workspace
  and Agent preset. The header control resolves the target the way the native New Session action does: the
  Workspace of the Session the app currently shows, falling back to the Workspace with the most
  recent activity. The Workspace
  controller reuses the first parked blank there or creates one under the Host default, so the overlay
  opens with the same Session and Agent preset the main New Session would show. It retains that
  Session and shows the native new-session controls — a searchable Workspace picker, the Agent preset
  chip, and the composer — in a white rounded panel over a backdrop mask, without the hero headline.
  Sending hands the board back and leaves the Session running in **Running**; closing without sending
  leaves the blank Session reusable. The Workspace picker opens as a menu under its chip and stays
  inside the overlay: choosing another Workspace connects a blank Session there through the same
  controller resolution (the target's own Agent preset or the Host default), carries the draft text
  across, and releases the previous Session; a draft with attachments refuses the switch rather than
  dropping them.
- Configures the **Recent** window from the gear in the Board tab's top-right: 1, 3, 7, or 30 days.
  The default is three days; the choice is browser-local and only filters Recent. Running and Unread
  never age out.
- Switches the page between **Board** (the three columns) and **Management** with the header's
  segmented control. Management lists every eligible Session, newest first, with a title filter; a row opens the same
  preview dialog a card does. A checkbox selects a row, the toolbar checkbox selects the filtered
  set, and **Archive** removes the selected Sessions after a confirmation. The batch runs one
  Session at a time: the Host refuses a Session whose work is still running, so the tab reports how
  many were refused and leaves those rows listed and selected. Archived Sessions can be restored
  from the native sidebar.
- Searches the whole Session list from the magnifier in the Board tab's top-right. Matching is a
  case-insensitive substring test on the card title — the host-facing label — over every eligible
  Session, not just the Recent window; blank drafts, subagent-origin rows, and archived Sessions stay
  out. The dialog opens with the newest-first list and the field focused; the arrow keys and Enter
  pick a row, and picking one opens the same preview dialog a card does, so a waiting Session still
  surfaces its native question. Closing that preview returns to the board.
- Embeds the native Conversation through the shared `conversation.content` Factory — the same host
  the subagent right-Sidebar chat uses — for both preview dialogs, the pending question's **Full
  conversation** page, and the new-conversation overlay, with a `SessionProvider` bound to a
  retained Session reference. The embedded body itself does not navigate or replace the main
  Conversation panel; the card control or the session dialog's **Open session** action opens the real
  panel, and closing releases the reference.
- Reads only the live client state DSH already publishes — the Session list, the unified Session
  status, and the Workspace archive set — so the board follows running state, pending interactions,
  and reads without polling or a host route. **Unread** combines pending interactions, DSH's own
  unread-completion marker, and a running→stopped edge the plugin observes globally. A stop counts
  unless that Session's conversation is on screen: the native page (conversation selected and
  retained as `mainView`) or a board preview, which retains the Session as `sessionManager` for as
  long as the embedded conversation is open. DSH leaves its own marker false when the Session stays
  `mainView`-retained behind a global panel, which is exactly the board's situation.
- Opening an unread completion marks it read: the preview dialog, the open-session control, and the
  conversation itself for as long as it stays open acknowledge it. The card moves from **Unread** to
  **Recent** and stays findable; it is not hidden. A **Running** Session that finishes on its
  visible real page or in an open preview is read and goes to **Recent**; one that finishes with no
  conversation on screen — while the board is visible, or behind it — lands in **Unread**. Both the
  read mark and the local stop note are browser-local and reset with the page.
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
nothing else. A later profile layer can still override that row by `id: session-manager`. The Recent
window is a browser-local board setting, not a profile option.

Safety: the host half registers nothing, reads nothing, writes nothing, and makes no network
requests. The browser half reads the Session list and unified UI status from the Web client, and the
archive and pin sets from the Workspace Controller. Opening a card retains one Session reference and renders
the native Conversation through the `conversation.content` Factory in the preview dialog; closing
releases the reference. The **New conversation** control creates or reuses the target Workspace's
blank Session through `uiWorkspace.connectWorkspace` and retains it for the overlay, together with a
`mainView` handle that the native Agent preset control requires (the board panel stays selected, so
this adds no navigation); sending or closing releases both. A Workspace switch resolves a blank in
the chosen Workspace through the same controller call and moves the draft text between the two input
shells, so it costs no navigation either. The card's open-session control and the
session dialog's **Open session** action navigate through `uiWorkspace.openSession` to the real
Session panel; the leading back control selects the board again. The preview dialog's
new-conversation control closes the preview and opens the overlay in the previewed Session's
Workspace under its Agent preset. The search dialog only reads the same live list snapshot and
retains a Session when its result is previewed. Pinning writes the Host pin set through
`uiWorkspace`, and the management tab writes the registry-global archive set through the same
service; the page never stops, renames, or pauses a Session, and a batch archive leaves a Session
whose work is still running untouched and reports the refusal. The native composer is the Session's
own input surface, used by the person in front of it. The only browser-local stored value is the Recent-window choice in `localStorage`; completion
read marks and local stop notes live in memory and reset with the page.

## How the columns are decided

`src/client/board.ts` is the pure classification step:

1. Keep only ordinary, non-blank, non-subagent, non-archived rows from the Session list.
2. A `pendingInteraction` puts the Session in **Unread**.
3. Otherwise a running turn puts it in **Running**. Until the status snapshot knows the row, the
   list row's own running flag is the fallback, matching the Workspace row.
4. Otherwise `completionUnread`, or a stop this plugin observed, puts it in **Unread**. A completion
   whose read mark is at least as new as the row does not count; an open preview keeps that mark
   current, so a turn that finishes there is read.
5. Everything else inside the configured **Recent** window goes to **Recent**, newest first, so read
   and idle Sessions remain findable.
6. Opening an unread completion only moves it from **Unread** to **Recent**; it never removes the
   row from the board.

`tests/board.spec.ts` covers the precedence, the filters, the read mark, the Recent-window
boundary, and the pinned states (whose ids now come from the Host pin set);
`tests/session-search.spec.ts` covers the full-list derivation and the title filter;
`tests/archive.spec.ts` covers the batch archive outcome;
`tests/recent-window.spec.ts` covers the window preference; `tests/back-to-board.spec.ts` covers the
return marker; `tests/conversation-input.spec.ts` covers the embedded Factory phase;
`tests/new-conversation.spec.ts` covers the current and most-recent target Workspace;
`tests/workspace-search.spec.ts` covers the picker's label rule and filter;
`tests/client.spec.ts` executes the built bundle and checks its registrations, baseline imports, CSS,
and source map.
