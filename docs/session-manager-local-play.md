# Session-manager local play

This is the first runnable slice of the network design: a directory server, two
nodes with independent `DSH_HOME` directories, and Session federation bridged
through the server. It is intentionally local-only: plain WebSocket on loopback,
no E2EE, no workspace merge, and no approval forwarding yet.

## 1. Build

```sh
pnpm --filter session-manager-server build
pnpm --filter dsh-plugin-session-manager build
```

## 2. Start the server

```sh
pnpm --filter session-manager-server start
```

Defaults:

| Setting | Value |
|---|---|
| Node WebSocket | `ws://127.0.0.1:8787/v1/node` |
| Admin HTTP | `http://127.0.0.1:8788` |
| State | `~/.session-manager-server/server.json` |
| Default group | `local` (more groups are created on demand) |

Both nodes need a route to this server; `127.0.0.1` only works when the server
and both DSH processes are on the same machine. For separate machines, bind a
reachable listen address and use that URL in both settings dialogs.

The first start prints one server-scoped join token. Later starts keep the state
and print no token. The same token creates a new group or joins an existing one.
To mint another token:

```sh
curl -s -X POST http://127.0.0.1:8788/admin/tokens \
  -H 'content-type: application/json' -d '{}'
```

`GET /admin/status` shows groups and online nodes.

## 3. Configure each node

Open the session-manager board and click its gear button. The settings dialog
edits the plugin's profile config directly; saving restarts the network runtime
and registers with the new values.

| Field | Meaning |
|---|---|
| `server` | Directory server URL, for example `ws://127.0.0.1:8787` |
| `token` | Server-scoped join token, used on registration and group creation |
| `name` | Node name; host name when empty |
| `group` | Server-assigned group id, also the immutable group name |

**New group** asks the server for an id and fills the field. Joining is just
pasting the other node's id into the same field.

There is no peer host or port. Each node opens one outbound WebSocket to the
server; the server bridges Session RPC between the two connections. A node never
needs to accept an inbound connection from another node.

The same fields remain available as profile config and environment fallbacks
(`SM_SERVER`, `SM_TOKEN`, `SM_NAME`, `SM_GROUP`) for headless starts. A profile
patch row looks like:

```yaml
- insert:
    - id: session-manager
      name: dsh-plugin-session-manager
      config:
        server: ws://127.0.0.1:8787
        token: smj_replace_me
        name: node-a
        group: grp_replace_me
```

The first use writes `$DSH_HOME/session-manager/instance.json` with one stable
`nid_...` installation hash, and the first registration writes
`$DSH_HOME/session-manager/network.json`; later starts in the same group prove
that identity with a signed hello and do not need the token. The server keeps
one node id per installation hash. Changing the group registers the node again, so keep the token in the
settings while switching groups.

## 4. Start two DSH homes

Start both DSH homes with the network fields empty. In node-a, fill the settings
dialog with the server URL, join token, and name, then press **New group**. The
server assigns a `grp_...` id; save it and node-a reconnects into that group. In
node-b, enter the same server/token, paste node-a's group id into its group
field, and save; node-b joins without a restart.

Both nodes use different `DSH_HOME` values but need no listening ports. The
group id is the only value node-b has to copy from node-a. A node name left empty
uses the machine host name. Start node-a first and wait until it is online, then
start node-b: the first `session.list` merge is what discovers the other node's
rows.

After upgrading this slice, restart the server before the nodes. The status
frames are new: an old server closes a new node that sends `status.publish`, and
a new server's status snapshot is ignored by an old node.

## 5. Expected result

- `GET /admin/status` reports two online nodes.
- Node A's board shows node B's Sessions with a `node-b` badge before the Workspace label;
  its own rows carry a `self` badge.
- The **Nodes** tab shows one vertical column per node, pinned Sessions first, and scrolls
  horizontally after three columns.
- Opening one renders the native Conversation on A. The host serving that
  Session remains B; A's host only forwards calls through the server.
- A prompt or cancel from A is forwarded to B. B's board shows the turn running.
- B's running/pending status reaches A within one status poll (three seconds).
- When B finishes a turn, A shows the same completion as unread. Opening it on A
  clears it on B too; opening on B clears it on A.
- Restarting A must not stop B's turn; A reconnects and follows the current
  state. B is the only writer. The server keeps unread rows across restarts.

If node B's rows do not appear, reload A's browser after both nodes are online,
then check the DSH log for:

```text
session-manager: federation installed for group ...
```

## 6. Limits in this slice

- The server relays Session RPC and keeps status metadata (running, pending, unread). It does
  not store Session content. The current transport is plain WebSocket with no TLS and no E2EE.
- No workspace-row merge; remote rows use their own `cwd` fallback.
- The owner publishes running/pending/unread rows; the browser polls the status route every
  three seconds and the Host list every five. A newly online peer needs no page reload.
- A browser that already holds a native unread marker imports it when the client mounts. A marker
  that disappeared before the browser loaded is not recoverable, because DSH never persisted it.
- Approval and question answering stays on the owning node.
- The admin listener has no token, so keep it loopback-only.

## 7. Tests

```sh
pnpm vitest run plugins/session-manager/tests
```

The network tests start a real server, register two nodes, exercise the bridged
peer RPC, verify that the federation wrapper merges and routes remote rows, and
verify the shared status publish/read round trip.
