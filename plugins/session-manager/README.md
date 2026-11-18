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
  The management tab's active rows wear the same badge.
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
- Omits blank drafts, subagent-origin rows, and archived Sessions. A card body opens its Session
  in one click. A waiting Session whose approval or question is answerable in this Client opens the
  native answer block in a dialog over the board: the approval card or question composer comes from
  the Conversation composer chain, so one click answers without navigating. A card, a search hit, or
  a management row without such an interaction navigates through `uiWorkspace.openSession` to the
  **real Session page**, which keeps its own composer, view tabs, right Sidebar, and header
  controls. A peer Session only carries a shared-status kind, so it keeps navigating; its answer
  stays on the owning node. Recent cards carry a hover/focus control that archives the Session in one
  click, with no confirmation: those rows are settled, so the Host cannot refuse them for running
  work, and the Management tab's archived set is where a mistaken click is undone. Only local rows
  get it, because the archive set is a local Workspace registry fact.
- Opening a Session from the board arms a compact back control that appears before the Session title
  and returns to the board; selecting any global panel clears it.
- Pins a Session from the icon that appears when its card is hovered or focused. Pinned Sessions move
  to a full-width **Pinned** rail above the columns and keep their runtime label there; the rail is
  absent until at least one pin exists. A local Session uses the registry-global Host pin set shared
  with the native sidebar, so pinning or unpinning from either surface updates the other. A remote
  Session cannot enter this Host's workspace registry; its pin is stored by the viewing browser and
  merged after the Host pins. The button only renders when the Session's access snapshot allows the
  action.
- Starts a new conversation from the **New conversation** control in the page's top-right. The
  control resolves the target the way the native New Session action does: the
  Workspace of the Session the app currently shows, falling back to the Workspace with the most
  recent activity. The Workspace
  controller reuses the first parked blank there or creates one under the Host default, so the overlay
  opens with the same Session and Agent preset the main New Session would show. It retains that
  Session and shows the native new-session controls — a node picker before a searchable Workspace
  picker, the Agent preset chip, and the composer — in a white rounded panel over a backdrop mask,
  without the hero headline. The node picker lists this host plus every online peer; choosing a peer
  creates a blank on that peer at the chosen directory through the bridge and carries the draft
  across. Each Nodes column also has a new-session button that opens the same overlay already on
  that node. Because the native shell only enables its composer for a Session that belongs to a
  Workspace in this browser's projection, a federated row is temporarily joined to the local
  Workspace with the same directory while it is open; the Host Workspace registry is not written.
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
  segmented control. Management lists every eligible Session, newest first, with a
  title-or-node-or-Workspace filter; each active row wears the node badge a card does, so one
  query lists every Session a node owns. An active row opens its Session page in one click, the
  same way a card does. A checkbox selects a row, the toolbar checkbox selects the filtered set, and
  **Archive** removes the
  selected Sessions after a confirmation. The batch runs one
  Session at a time: the Host refuses a Session whose work is still running, so the tab reports how
  many were refused and leaves those rows listed and selected.
- Switches Management between **Active** and **Archived**. The archived set is the undo surface for
  the card's one-click archive: each row can be restored in place, or the filtered selection can be
  restored in one batch. An archived row is plain text rather than a button, because an archived
  conversation cannot be opened until it is restored. The archive set is this Host's registry, so an
  archived row is local by definition and carries no node badge.
- Searches the whole Session list from the magnifier in the Board tab's top-right. Matching is a
  case-insensitive substring test over what a row shows: the card title — the host-facing label —
  the node badge, and the Workspace the Session lives in, named by the Workspace title or the
  directory basename. A Workspace name therefore lists every Session of that project, including
  Sessions whose durable title says nothing about it, and a node name lists every Session that node
  owns. The search covers every eligible Session, not just the Recent window; blank drafts,
  subagent-origin rows, and archived Sessions stay out. The dialog opens with the
  newest-first list and the field focused; the arrow keys and Enter pick a row, and picking one
  follows the card rule: an answerable waiting Session opens its native block, every other row opens
  its Session page.
- Embeds the native Conversation through the shared `conversation.content` Factory — the same host
  the subagent right-Sidebar chat uses — for the new-conversation overlay and for the waiting
  dialog, with a `SessionProvider` bound to a retained Session reference. The waiting dialog passes a
  null `views` component, so the Factory renders the composer seat's approval or question takeover
  and skips the transcript; this is the native block, not a copy. Neither surface replaces the main
  Conversation panel; closing or sending releases the reference. A row that cannot host its block
  navigates to the product's own Session page instead, which is why no embedded surface has to
  reproduce the right Sidebar, the view tabs, or the header actions.
- Reads the live client state DSH already publishes — the Session list, the unified Session
  status, and the Workspace archive set — and, when the network runtime is configured, the shared
  status route. **Unread** combines pending interactions, DSH's unread-completion marker, and the
  host's running→stopped observation. A stop counts unless that Session's conversation is on
  screen: the native page (conversation selected and retained as `mainView`) or an embedded
  Conversation this plugin hosts, which retains the Session as `sessionManager` for as long as it is
  open.
- Opening an unread completion marks it read: the click that opens its page acknowledges it, and
  the conversation itself does for as long as it stays open. The card moves from **Unread** to
  **Recent** and stays findable; it is not hidden. With the network runtime, the read is sent to the
  Host and broadcast to every node, so the same completion clears there too. Without a server, the
  read mark and stop note stay browser-local.
- Each DSH home gets one persistent installation hash (`nid_...`) before its first registration.
  The host sends it on register and hello, and the server reuses one node id for that installation.
- Carries an optional host runtime. With a server URL configured, the host half registers with the
  directory server, bridges peer Session RPC over that single WebSocket, federates peer Sessions
  into the ordinary Session Controller surface, and keeps the shared status/unread registry. The
  The endpoints that name an Agent follow the node too: the `@` menu, the `/` command catalog, and
  a Session's skills list are answered by the node that owns the Session, because this browser's
  Host resolves a local Agent for those endpoints and a federated row has none. No
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
route when the runtime is configured, and the archive and pin sets from the Workspace Controller.
A card, a search hit, or a management row without an answerable waiting block navigates through
`uiWorkspace.openSession` to the real Session panel, and the leading back control selects the board
again; no Session reference is retained for it. A waiting row with an answerable approval or question
retains one reference for its dialog and releases it on close, without navigating. The **New
conversation** control creates or reuses the target Workspace's blank Session through
`uiWorkspace.connectWorkspace` and retains it for the overlay, together with a `mainView` handle that
the native Agent preset control requires (the board panel stays selected, so this adds no
navigation); sending or closing releases both. A Workspace switch resolves a blank in the chosen
Workspace through the same controller call and moves the draft text between the two input shells, so
it costs no navigation either. The Recent card's archive control writes the registry-global archive
set through `uiWorkspace`, gated by the Session's access snapshot. The search dialog only reads the
same live list snapshot. Pinning a local Session writes the Host pin set
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
   mark is at least as new as the row does not count. Opening the Session records that mark.
5. Everything else inside the configured **Recent** window goes to **Recent**, newest first, so read
   and idle Sessions remain findable.
6. Opening an unread completion only moves it from **Unread** to **Recent**; it never removes the
   row from the board.

`archivedSessions` in `src/client/session-search.ts` applies the same eligibility rules inverted:
it keeps only the rows in the registry archive set, which is what the management tab's archived view
lists and restores from.

`tests/board.spec.ts` covers the precedence, the filters, the read mark, the Recent-window
boundary, the pinned states (whose ids come from the Host pin set plus the browser-local remote pin
order), and the inline waiting-block classifier; `tests/remote-pins.spec.ts` covers that stored order;
`tests/session-search.spec.ts` covers the full-list and archived derivations and the
title-or-node-or-Workspace filter;
`tests/archive.spec.ts` covers the batch archive and unarchive outcomes;
`tests/recent-window.spec.ts` covers the window preference; `tests/back-to-board.spec.ts` covers the
return marker; `tests/conversation-input.spec.ts` covers the embedded Factory phase;
`tests/new-conversation.spec.ts` covers the current and most-recent target Workspace;
`tests/workspace-search.spec.ts` covers the picker's label rule and filter;
`tests/client.spec.ts` executes the built bundle and checks its registrations, baseline imports, CSS,
and source map.
