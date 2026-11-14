# Session-manager network

**Status:** implemented local slice. Nodes are equal peers; there is no primary
or fleet controller. Each node keeps one outbound WebSocket to the directory
server, and the server bridges peer Session RPC between those connections.

## 1. Model

- A **node** is one DSH home with this plugin installed.
- A **group** is a directory and federation boundary; a server-scoped token may create a group or join an existing one.
- A **Session owner** is the node whose host holds the Session write lock.
- There is no master node. Each node manages and answers for its own Sessions;
  peers may view and drive them through the bridge.

A node does not need a reachable address. Its only network requirement is an
outbound WebSocket to the server.

## 2. Registration and directory

The plugin stores a durable Ed25519/X25519 identity in
`$DSH_HOME/session-manager/network.json`. The first connection registers with a
server-scoped join token and the selected group id; later connections prove the
identity with a signed hello. The server accepts many groups; each node belongs
to exactly one, and the directory is computed per group. A registration without
a group id keeps the old single-group behavior by joining the first group.

The server publishes directory rows with node id, name, public keys, online
state, and last-seen time. It never publishes a peer endpoint because there is
no peer listener.

## 3. Session visibility and control

When a node lists Sessions, its federation wrapper:

1. calls the local Session Controller and keeps those rows;
2. asks each online peer for its local list through the bridge;
3. merges remote rows into the same result, titled `[peer-name] <title>`;
4. remembers the remote Session id and its owning node.

For a remembered remote id, follow/state/projections/events/page/prompt/
cancel/rename/attachment/selectModel/updateQueue and the observation streams
are sent over the bridge to the owner. The owner executes them against its
local Session Controller. The remote Session is never opened in the local host,
so the owner remains the only writer.

The native Conversation works because the remote rows are ordinary
`SessionSummary` values and `session.follow` returns the owner's native frames.
No fake client binding is involved.

### Shared status and unread

The owner publishes a status row for each local Session: `running`, `pending`
kind (`approval`, `question`, or `other`), `unread`, `updatedAt`, and `readAt`.
The server keeps this metadata in the group record and pushes every change to
the other nodes.

A browser reads the merged status through `GET /api/session-manager/status` on
its own host. Opening a card posts to `/api/session-manager/read`, which sends a
read acknowledgement to the server. The server clears `unread` and broadcasts
the new row to every node, including the owner, so a read on A clears the same
completion on B. A browser that already holds a native unread marker imports it
with `/api/session-manager/report`; the host ignores it when the server already
has a newer read mark.

## 4. Bridge protocol

Frames on the node-server socket:

- `bridge.request`: caller to owner, with id, target, operation, args
- `bridge.response`: unary result
- `bridge.stream`: one stream item
- `bridge.end`: stream completed
- `bridge.error`: operation or peer failure
- `bridge.cancel`: caller stopped consuming
- `status.publish`: owner publishes one Session's running/pending/unread row
- `status.read`: any node acknowledges one completion
- `status.state`: server pushes the merged row to the group

The server checks that both nodes are authenticated, online, and in the same
group, then forwards the frame with the authenticated sender id. It does not
open, read, or persist Session files. An offline target returns
`bridge/offline`.

A request id is unique per caller. The server tracks the route so a caller
disconnect cancels the owner's stream, and an owner disconnect fails the
caller's pending request.

## 5. Ownership rules

- The owner is the only writer of its Session.
- Prompt, cancel, rename, queue edits, model selection, and attachments are
  forwarded to the owner; they are not applied locally.
- Approvals and questions remain on the owner. A peer can see that a Session is
  waiting, but the answer is given on the owner.
- A peer disconnect does not stop the owner's turn.

## 6. Configuration

The board settings dialog edits four volatile fields:

| Field | Meaning |
|---|---|
| `server` | Directory server URL; empty disables networking |
| `token` | Server join token, used for first registration and group creation |
| `name` | Node name; host name when empty |
| `group` | Server-assigned group id to join; empty uses the single-group compatibility path |

The group name is its id, so there is one value to copy. **New group** posts
`server` and `token` to the host's `/api/session-manager/group` route, which
calls `POST /v1/groups` on the server and fills the assigned id. A second node
pastes that id into the same field. Group creation works before the runtime is
configured; the registration itself starts after saving and restarting DSH.

The same fields are available through the profile config and `SM_SERVER`,
`SM_TOKEN`, `SM_NAME`, and `SM_GROUP` environment fallbacks.

## 7. Limits

- The server relays peer payloads; it is a trusted relay, not an E2EE tunnel.
- Plain WebSocket in this slice. TLS and E2EE are future work.
- The board polls the Host list every five seconds; status rows poll every three
  seconds, so a peer change is visible after at most one poll interval.
- Running, pending, and unread state is shared and persisted by the server. The
  owner publishes its browser's pre-existing unread markers when the client
  mounts; a marker that vanished before the client ever loaded is not recoverable.
- Full-list search is not merged.
- Workspace rows and file destinations are not merged.
- Groups are created on demand; the first start also creates one default group.

## 8. Tests

The network tests cover:

- server registration and directory presence;
- bridge request/response routing and offline errors;
- responder/PeerPool list, follow, and prompt over an in-memory bridge;
- federation merge and call routing;
- status publish/read and the status route;
- runtime registration against a real server.

```sh
pnpm vitest run plugins/session-manager/tests
```
