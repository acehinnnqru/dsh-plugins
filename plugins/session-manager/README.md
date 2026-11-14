# dsh-plugin-session-manager

A sidebar entry, a main-column board that keeps running, unread, and recent Sessions in view, a
per-node Nodes board, a management tab for batch archiving, a full-list session search, and a
full-screen new-conversation overlay that embeds the native composer.

## What it does

- Adds one row to the sidebar's global panel list, after Plugins and Automation tasks. Selecting it
  opens the page in the main column on the Board tab. The product owns the row button, its label, and
  its selected state; this plugin contributes the icon and the page behind the row.
- Draws three columns: **Running**, **Unread**, and **Recent**. Every card names its owning node
  before the Workspace label: a remote node shows its node name and a local Session shows **self**.
- Adds a **Nodes** tab with one vertical column per node. Pinned Sessions head their node column;
  every other Session follows newest first. Up to three columns share the width, and more nodes
  scroll horizontally.
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
  under its Agent preset, then closes the preview. Its archive control, left of the
  new-conversation control, archives the previewed Session through the same Host command the native
  sidebar uses and then closes the preview; a Session whose work still runs is refused, and the
  dialog stays open with the refusal reported above the Conversation. A click on a file reference, an
  external link, or a turn's changed-files card moves to the real Session page and opens the
  destination in that page's right Sidebar in the same click: the column exists only there, so the
  embedded Conversation hands the click over instead of failing on it. A file opens at the top of
  its viewer, and a changed-files header or row reopens the turn's review on the page the click
  moved to. Hovering a changed-files header or row still previews that file's diff inside the
  dialog: the shared hover card is lifted above the dialog's mask while the dialog is open.
- When the open-session control or the session dialog's **Open session** action opens the real page,
  a compact back control appears before the Session title and returns to the board; selecting any
  global panel clears it. The pending dialog keeps its own close control, and its expanded page keeps
  the back bar.
- Pins a Session from the icon that appears when its card is hovered or focused. Pinned Sessions move
  to a full-width **Pinned** rail above the columns and keep their runtime label there; the rail is
  absent until at least one pin exists. A local Session uses the registry-global Host pin set shared
  with the native sidebar, so pinning or unpinning from either surface updates the other. A remote
  Session cannot enter this Host's workspace registry; its pin is stored by the viewing browser and
  merged after the Host pins. The button only renders when the Session's access snapshot allows the
  action.
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
  never age out. The same dialog carries the network fields — server URL, join token, node name,
  and group id — and saves them through the Host settings form. The group name is its id;
  **New group** asks the server for one, and joining is pasting that id into the same field.
  Saving restarts the network runtime with the new values. The node name is empty by default and
  the Host uses the machine host name.
- Switches the page between **Board** (the three columns) and **Management** with the header's
  segmented control. Management lists every eligible Session, newest first, with a title-or-Workspace
  filter; a row opens the same preview dialog a card does. A checkbox selects a row, the toolbar
  checkbox selects the filtered set, and **Archive** removes the selected Sessions after a
  confirmation. The batch runs one
  Session at a time: the Host refuses a Session whose work is still running, so the tab reports how
  many were refused and leaves those rows listed and selected. Archived Sessions can be restored
  from the native sidebar.
- Searches the whole Session list from the magnifier in the Board tab's top-right. Matching is a
  case-insensitive substring test over what a row shows: the card title — the host-facing label — and
  the Workspace the Session lives in, named by the Workspace title or the directory basename. A
  Workspace name therefore lists every Session of that project, including Sessions whose durable
  title says nothing about it. The search covers every eligible Session, not just the Recent window;
  blank drafts, subagent-origin rows, and archived Sessions stay out. The dialog opens with the
  newest-first list and the field focused; the arrow keys and Enter pick a row, and picking one opens
  the same preview dialog a card does, so a waiting Session still surfaces its native question.
  Closing that preview returns to the board.
- Embeds the native Conversation through the shared `conversation.content` Factory — the same host
  the subagent right-Sidebar chat uses — for both preview dialogs, the pending question's **Full
  conversation** page, and the new-conversation overlay, with a `SessionProvider` bound to a
  retained Session reference. The embedded body itself does not navigate or replace the main
  Conversation panel; the card control or the session dialog's **Open session** action opens the real
  panel, and closing releases the reference.
- Reads the live client state DSH already publishes — the Session list, the unified Session
  status, and the Workspace archive set — and, when the network runtime is configured, the shared
  status route. **Unread** combines pending interactions, DSH's unread-completion marker, and the
  host's running→stopped observation. A stop counts unless that Session's conversation is on
  screen: the native page (conversation selected and retained as `mainView`) or a board preview,
  which retains the Session as `sessionManager` for as long as the embedded conversation is open.
- Opening an unread completion marks it read: the preview dialog, the open-session control, and the
  conversation itself for as long as it stays open acknowledge it. The card moves from **Unread** to
  **Recent** and stays findable; it is not hidden. With the network runtime, the read is sent to the
  Host and broadcast to every node, so the same completion clears there too. Without a server, the
  read mark and stop note stay browser-local.
- Each DSH home gets one persistent installation hash (`nid_...`) before its first registration.
  The host sends it on register and hello, and the server reuses one node id for that installation.
- Carries an optional host runtime. With a server URL configured, the host half registers with the
  directory server, bridges peer Session RPC over that single WebSocket, federates peer Sessions
  into the ordinary Session Controller surface, and keeps the shared status/unread registry. No
  node opens an inbound listener. With no server URL it starts no network runtime; it still
  serves the authenticated group-create route so the settings dialog can bootstrap a group. See
  [`docs/session-manager-local-play.md`](../../docs/session-manager-local-play.md).

## Install into a profile

Build first — the profile installs `lib/index.js` and `lib/client.js`, and a `link:`/path install
serves those files straight from this directory:

```sh
pnpm --filter dsh-plugin-session-manager build
dsh plugin --profile <profile> add ./plugins/session-manager
```

`dsh` lives only in the maintainer's environment (DSH checkout); nothing in this repo
calls it. The full checklist is in [`docs/install.md`](../../docs/install.md).

## Development loop

```sh
# terminal A, in this repo
pnpm --filter dsh-plugin-session-manager watch

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

Safety: without a server URL the host half starts no network runtime and makes no network
requests until the settings dialog asks it to create a group. With one, it owns the group/status
routes and the outbound node socket. The
browser half reads the Session list and unified UI status from the Web client, the shared status
route when the runtime is configured, and the archive and pin sets from the Workspace Controller. Opening a card retains one Session reference and renders
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
Workspace under its Agent preset; its archive control writes the same registry-global archive set
through `uiWorkspace`, gated by the Session's access snapshot, and closes the preview on success.
A file or external-link click inside the embedded Conversation is captured before the product's own
handler runs and navigates through `uiWorkspace.openSession` to the real page, which is the only
surface with the right Sidebar those destinations open in. The destination then opens through
`ctx.get('sidebarRight')`: a file as a `dsh-resource://file/session/…` address, a web link as the
column's browser page unless the Chat setting sends links to a new browser tab. The command is
retried for a few frames because the column is mounted only once that page renders, and this plugin
treats the column as optional — a build without it keeps the navigation and opens a link in the
browser instead. A change review is different: only the changed-files card's own handler holds the
turn's coordinates, so the page's copy of that card is clicked rather than the column command run.
The card sits in its turn's tail, which the page draws for the newest turns; a card the transcript
has virtualized out is left unserved, and the click has still moved to the page.
The search dialog only reads the same live list snapshot and
retains a Session when its result is previewed. Pinning a local Session writes the Host pin set
through `uiWorkspace`; pinning a remote one writes the browser-local remote pin order, because the
Host registry rejects ids it does not own. The management tab writes the registry-global archive set
through the same service; the page never stops, renames, or pauses a Session, and a batch archive
leaves a Session whose work is still running untouched and reports the refusal. The native composer
is the Session's own input surface, used by the person in front of it. The browser-local stored
values are the Recent-window choice and the remote pin order; without a server, completion read
marks and local stop notes live in memory and reset with the page. With a server, the host publishes them through the
shared status registry.

## How the columns are decided

`src/client/board.ts` is the pure classification step:

1. Keep only ordinary, non-blank, non-subagent, non-archived rows from the Session list.
2. A `pendingInteraction` puts the Session in **Unread**.
3. Otherwise a running turn puts it in **Running**. Until the status snapshot knows the row, the
   list row's own running flag is the fallback, matching the Workspace row.
4. Otherwise shared `unread`, `completionUnread`, or a stop this plugin observed puts it in
   **Unread**. A shared read clears it on every node; without a shared row, a completion whose read
   mark is at least as new as the row does not count. An open preview keeps that mark current, so a
   turn that finishes there is read.
5. Everything else inside the configured **Recent** window goes to **Recent**, newest first, so read
   and idle Sessions remain findable.
6. Opening an unread completion only moves it from **Unread** to **Recent**; it never removes the
   row from the board.

`tests/board.spec.ts` covers the precedence, the filters, the read mark, the Recent-window
boundary, and the pinned states (whose ids come from the Host pin set plus the browser-local remote
pin order); `tests/remote-pins.spec.ts` covers that stored order;
`tests/session-search.spec.ts` covers the full-list derivation and the title-or-Workspace filter;
`tests/archive.spec.ts` covers the batch archive outcome;
`tests/recent-window.spec.ts` covers the window preference; `tests/back-to-board.spec.ts` covers the
return marker; `tests/conversation-input.spec.ts` covers the embedded Factory phase;
`tests/new-conversation.spec.ts` covers the current and most-recent target Workspace;
`tests/workspace-search.spec.ts` covers the picker's label rule and filter;
`tests/preview-links.spec.ts` covers which embedded clicks leave for the real Session page and
what they name; `tests/right-column.spec.ts` covers the file address, the mount wait, and the
changed-files replay;
`tests/client.spec.ts` executes the built bundle and checks its registrations, baseline imports, CSS,
and source map.
