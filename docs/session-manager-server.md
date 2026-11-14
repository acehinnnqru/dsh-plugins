# Session-manager server

**Status:** implemented local slice. The server authenticates nodes, creates groups, publishes each group
directory, bridges peer Session RPC between their WebSocket connections, and
keeps the shared Session management status rows (running, pending, unread). It
never stores Session content and never opens a listener on a node.

## 1. Scope

One process, one JSON state file, one public HTTP/WebSocket listener, and one
loopback-only admin listener. The public socket is `/v1/node`.

The server owns:

- a default group on first start and server-assigned group creation
- server-scoped join-token resolution
- Ed25519 registration and reconnect proofs
- the directory and online presence per group
- request routing between two online nodes in the same group
- the shared Session status registry: running, pending kind, unread, updatedAt,
  readAt, and revision per Session id

The server does not own Session files, Session content, approvals, or a queue.

## 2. Configuration

`--config <path>` reads JSON. Defaults:

| Setting | Default |
|---|---|
| `listen.host` | `127.0.0.1` |
| `listen.port` | `8787` |
| `adminPort` | `8788` |
| `stateDir` | `~/.session-manager-server` |
| `group` | name of the default group: `local` |

The first start creates a default group and prints one server-scoped join
token. Later starts load the same state and print no token. The token creates or
joins any group. Mint another token with:

```sh
curl -s -X POST http://127.0.0.1:8788/admin/tokens \
  -H 'content-type: application/json' -d '{}'
```

## 3. Node lifecycle

1. A node opens one WebSocket to `ws://<server>/v1/node`.
2. First time: `register` with the join token, name, X25519 public key, Ed25519
   public key, timestamp, and a signature over
   `["smnet-register-v1", 1, name, encKey, signKey, ts]`.
3. The registration may carry `groupId`; the server resolves the server-scoped
   token, selects that group (or the only group when omitted), checks name and
   key uniqueness inside it, stores the node, and returns `welcome` with the
   group directory.
4. Later connections send `hello` with `nodeId`, `groupId`, timestamp, nonce,
   and a signature over
   `["smnet-hello-v1", 1, nodeId, groupId, ts, nonce]`.
5. The server answers `ping`; the node answers `pong`. A missed heartbeat closes
   the connection and broadcasts `node.offline`.

There is no `update` frame and no advertised endpoint. A node needs no inbound
port.

## 4. Bridge

The same socket carries peer RPC. The server keeps no Session state; it routes
frames between two authenticated connections in one group.

| Frame | Direction | Purpose |
|---|---|---|
| `bridge.request` | caller to server to owner | one unary or streaming operation |
| `bridge.response` | owner to server to caller | unary result |
| `bridge.stream` | owner to server to caller | one stream item |
| `bridge.end` | owner to server to caller | stream completed |
| `bridge.error` | owner/server to caller | operation or peer failed |
| `bridge.cancel` | caller to server to owner | caller stopped consuming |
| `status.publish` | owner to server | one local Session's running, pending, unread, updatedAt |
| `status.read` | any node to server | clear unread at a read mark |
| `status.state` | server to group | the merged status row |

Rules:

- The server overwrites `from` with the authenticated node id; a node cannot
  claim another sender.
- The target must be online and in the same group. An offline target produces
  `bridge.error` with code `bridge/offline`.
- Request ids are namespaced by the caller. The server remembers the active
  route so a disconnect cancels the owner's stream or fails the caller's
  pending request.
- A request id is ended by unary response, stream end, or error.
- The public socket accepts frames up to 16 MiB. The server does not interpret
  the bridge operation payload.
- `status.publish` is accepted only from the node that first claimed the Session;
  `status.read` is accepted from any node in the group. A read clears `unread`
  only up to the owner's `updatedAt`, so a new completion after the read becomes
  unread again.
- The welcome frame carries the persisted status snapshot, so a restarting node
  does not erase a read mark held by another node.

## 5. Group bootstrap

The public listener also accepts one JSON endpoint:

```http
POST /v1/groups
{ "token": "smj_...", "name": "optional display name" }
```

The server validates the token, assigns `grp_...`, and returns
`{ "groupId": "grp_..." }`. The group name is that id; it is not user-editable.
The node UI calls this through its own host route, so the browser never talks to
the server cross-origin. Creating a group does not increment the token's use
count; joining with a node does.

## 6. Admin

The admin listener binds `127.0.0.1` only and has no token.

| Route | Method | Purpose |
|---|---|---|
| `/healthz` (public) | GET | process health and online count |
| `/admin/status` | GET | groups and online count |
| `/admin/groups` | GET | group ids and names |
| `/admin/tokens` | POST | mint a server-scoped token |
| `/admin/groups` | POST | create a group |
| `/admin/groups/:id/nodes` | GET | node rows and presence |
| `/admin/nodes/:id/revoke` | POST | revoke a node and close it |

## 7. State and failure behavior

State is JSON written atomically: temporary file, fsync, rename, directory
fsync, and owner-only mode. Writes are serialized, so a status update and a
control-plane write cannot race on the same temporary file. Tokens live at
server scope and are stored as hashes; an old group-scoped token file is
migrated on load. Node rows keep the public keys and metadata, not endpoints.
Status rows keep only management metadata, never messages or files.

The process is authoritative while it runs. A restart reloads state; nodes
reconnect with signed hellos and need no token. A wiped state requires a token
again.

## 8. Limits

- Plain WebSocket; TLS is a deployment concern and E2EE is not implemented.
- The server sees Session RPC payloads while relaying them.
- One default group is created on first start; more groups are created on demand.
- No metric, audit, or request queue.
- Node keys are used for registration and reconnect proofs; the relay is not
  end-to-end encrypted yet.

## 9. Tests

```sh
pnpm vitest run plugins/session-manager/tests/network-server.spec.ts
```

The test starts a real server, registers nodes, and asserts directory,
presence, bridge request/response routing, the offline-target error, and the
status publish/read round trip including the persisted welcome snapshot.
