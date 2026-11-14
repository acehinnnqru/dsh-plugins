# Session-manager server

**Status:** implemented local slice. The server authenticates nodes, publishes the
group directory, bridges peer Session RPC between their WebSocket connections,
and keeps the shared Session management status rows (running, pending, unread).
It never stores Session content and never opens a listener on a node.

## 1. Scope

One process, one JSON state file, one public HTTP/WebSocket listener, and one
loopback-only admin listener. The public socket is `/v1/node`.

The server owns:

- group creation on first start
- join-token resolution
- Ed25519 registration and reconnect proofs
- the directory and online presence
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
| `group` | `local` |

The first start creates the group and prints one join token. Later starts load
the same state and print no token. Mint another token with:

```sh
curl -s -X POST http://127.0.0.1:8788/admin/tokens \
  -H 'content-type: application/json' -d '{}'
```

## 3. Node lifecycle

1. A node opens one WebSocket to `ws://<server>/v1/node`.
2. First time: `register` with the join token, name, X25519 public key, Ed25519
   public key, timestamp, and a signature over
   `["smnet-register-v1", 1, name, encKey, signKey, ts]`.
3. The server resolves the token, checks name and key uniqueness in the group,
   stores the node, and returns `welcome` with the directory.
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

## 5. Admin

The admin listener binds `127.0.0.1` only and has no token.

| Route | Method | Purpose |
|---|---|---|
| `/healthz` (public) | GET | process health and online count |
| `/admin/status` | GET | groups and online count |
| `/admin/groups` | GET | group ids and names |
| `/admin/tokens` | POST | mint a token |
| `/admin/groups/:id/nodes` | GET | node rows and presence |
| `/admin/nodes/:id/revoke` | POST | revoke a node and close it |

## 6. State and failure behavior

State is JSON written atomically: temporary file, fsync, rename, directory
fsync, and owner-only mode. Writes are serialized, so a status update and a
control-plane write cannot race on the same temporary file. Tokens are stored
as hashes. Node rows keep the public keys and metadata, not endpoints. Status
rows keep only management metadata, never messages or files.

The process is authoritative while it runs. A restart reloads state; nodes
reconnect with signed hellos and need no token. A wiped state requires a token
again.

## 7. Limits

- Plain WebSocket; TLS is a deployment concern and E2EE is not implemented.
- The server sees Session RPC payloads while relaying them.
- Only one group is created on first start.
- No metric, audit, or request queue.
- Node keys are used for registration and reconnect proofs; the relay is not
  end-to-end encrypted yet.

## 8. Tests

```sh
pnpm vitest run plugins/session-manager/tests/network-server.spec.ts
```

The test starts a real server, registers nodes, and asserts directory,
presence, bridge request/response routing, the offline-target error, and the
status publish/read round trip including the persisted welcome snapshot.
