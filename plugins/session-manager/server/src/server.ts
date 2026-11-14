/**
 * One-process registration, directory, and bridge server.
 *
 * Public WebSocket: /v1/node. Admin HTTP: loopback only. Session RPC is relayed
 * between node sockets but never stored; the only per-node state is the socket.
 * @module session-manager-server/server
 */

import { createPublicKey, verify as verifySignature } from 'node:crypto'
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  canonicalHello,
  canonicalRegister,
  type BridgeErrorFrame,
  type BridgeFrame,
  type ClientFrame,
  type ErrorFrame,
  type HelloFrame,
  type NodeEventFrame,
  type PeerInfo,
  type RegisterFrame,
  type ServerFrame,
  type SessionStatusRecord,
  type StatusPublishFrame,
  type StatusReadFrame,
  type StatusStateFrame,
  type WelcomeFrame,
} from './protocol.ts'
import {
  freshState,
  loadState,
  mintToken,
  peerInfo,
  randomBase32,
  removeStaleTemp,
  resolveToken,
  saveState,
  type Group,
  type NodeRecord,
  type TokenRecord,
} from './state.ts'

/** Deployment configuration. */
export interface ServerConfig {
  readonly listen?: { readonly host?: string; readonly port?: number }
  readonly adminPort?: number
  readonly stateDir?: string
  readonly group?: string
}

/** Running server handle. */
export interface RunningServer {
  readonly groupId: string
  readonly groupName: string
  readonly token: string | undefined
  close(): Promise<void>
}

interface Connection {
  readonly ws: WebSocket
  readonly nodeId: string
  readonly groupId: string
  lastSeen: number
  awaitingPong: boolean
}

const REGISTER_WINDOW_MS = 5 * 60_000
const HELLO_WINDOW_MS = 2 * 60_000
const ONLINE_WINDOW_MS = 45_000
const MAX_BODY = 16 * 1024

/** Validate a node name. */
function validName(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,64}$/.test(value)
}

/** Import a raw Ed25519 or X25519 public key from base64url bytes. */
function importRawKey(value: string, kind: 'ed25519' | 'x25519') {
  const raw = Buffer.from(value, 'base64url')
  if (raw.length !== 32) throw new Error('public key must be 32 bytes')
  const prefix = kind === 'ed25519'
    ? Buffer.from('302a300506032b6570032100', 'hex')
    : Buffer.from('302a300506032b656e032100', 'hex')
  return createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' })
}

/** Ed25519 verify over a UTF-8 canonical string. */
function verifyProof(signKey: string, canonical: string, proof: string): boolean {
  try {
    return verifySignature(null, Buffer.from(canonical, 'utf8'), importRawKey(signKey, 'ed25519'), Buffer.from(proof, 'base64url'))
  } catch {
    return false
  }
}

/** Parse one JSON frame from a socket. */
function parseFrame(data: unknown): ClientFrame | undefined {
  try {
    const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
    const value = JSON.parse(text) as ClientFrame
    return typeof value === 'object' && value !== null && typeof value.type === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/** Send one frame when the socket is open. */
function send(ws: WebSocket, frame: ServerFrame): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(frame))
}

/** Send one error frame and close the socket. */
function fail(ws: WebSocket, code: string, message: string): void {
  const frame: ErrorFrame = { type: 'error', v: 1, code, message }
  send(ws, frame)
  ws.close(4000 + 0, code)
}

/** Read a bounded JSON request body. */
async function readBody(request: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY) throw new Error('body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** Respond with JSON. */
function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

/** Start the server. */
export async function startServer(config: ServerConfig): Promise<RunningServer> {
  const stateDir = config.stateDir ?? '~/.session-manager-server'
  const host = config.listen?.host ?? '127.0.0.1'
  const port = config.listen?.port ?? 8787
  const adminPort = config.adminPort ?? 8788
  const groupName = config.group ?? 'local'

  await removeStaleTemp(stateDir)
  let state = await loadState(stateDir)
  let token: string | undefined
  if (state === undefined) {
    const fresh = freshState(groupName)
    state = fresh.state
    token = fresh.token
    await saveState(stateDir, state)
  }
  const group = Object.values(state.groups)[0]
  if (group === undefined) throw new Error('server state has no group')
  const groupId = group.id

  /** Serialized control-plane writes; several status frames can arrive between awaits. */
  let saveChain = Promise.resolve()
  const persist = (): Promise<void> => {
    saveChain = saveChain.catch(() => {}).then(() => saveState(stateDir, state))
    return saveChain
  }

  /** Create one empty group whose immutable name is its id. */
  const createGroup = async (): Promise<Group> => {
    const id = 'grp_' + randomBase32(12)
    const group: Group = {
      id,
      name: id,
      createdAt: Date.now(),
      nodes: {},
      statuses: {},
    }
    state.groups[group.id] = group
    await persist()
    return group
  }

  const connections = new Map<string, Connection>()
  const nonces = new Map<string, Map<string, number>>()
  /** Active bridge operations, used to cancel or fail them when a node drops. */
  const routes = new Map<string, { readonly from: string; readonly to: string }>()

  const directory = (groupIdToRead: string): PeerInfo[] => {
    const current = state.groups[groupIdToRead]
    if (current === undefined) return []
    return Object.values(current.nodes)
      .filter((node) => node.revokedAt === null)
      .map((node) => peerInfo(node, connections.has(node.id), connections.get(node.id)?.lastSeen ?? 0))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  const broadcast = (groupIdToSend: string, frame: ServerFrame, except?: string): void => {
    for (const connection of connections.values()) {
      if (connection.groupId !== groupIdToSend || connection.nodeId === except) continue
      send(connection.ws, frame)
    }
  }

  const onlineEvent = (node: NodeRecord, type: 'node.online' | 'node.updated'): NodeEventFrame => ({
    type,
    v: 1,
    peer: peerInfo(node, true, connections.get(node.id)?.lastSeen ?? Date.now()),
  })

  const register = async (frame: RegisterFrame): Promise<WelcomeFrame> => {
    if (frame.v !== 1) throw new Error('protocol/version')
    if (!validName(frame.name)) throw new Error('register/name-invalid')
    if (!Number.isInteger(frame.ts) || Math.abs(Date.now() - frame.ts) > REGISTER_WINDOW_MS) {
      throw new Error('register/proof-invalid')
    }
    try {
      importRawKey(frame.encKey, 'x25519')
      importRawKey(frame.signKey, 'ed25519')
    } catch {
      throw new Error('register/key-invalid')
    }
    const token = resolveToken(state, frame.token)
    if (token === undefined) throw new Error('token/invalid')
    if (token.revokedAt !== null) throw new Error('token/invalid')
    if (token.expiresAt !== 0 && token.expiresAt < Date.now()) throw new Error('token/invalid')
    if (token.maxUses !== 0 && token.uses >= token.maxUses) throw new Error('token/exhausted')
    if (!verifyProof(frame.signKey, canonicalRegister(frame.name, frame.encKey, frame.signKey, frame.ts), frame.proof)) {
      throw new Error('register/proof-invalid')
    }
    const target = frame.groupId === undefined
      ? Object.values(state.groups)[0]
      : state.groups[frame.groupId]
    if (target === undefined) {
      throw new Error(frame.groupId === undefined ? 'group/required' : 'group/not-found')
    }
    for (const node of Object.values(target.nodes)) {
      if (node.revokedAt !== null) continue
      if (node.name === frame.name) throw new Error('group/name-taken')
      if (node.encKey === frame.encKey || node.signKey === frame.signKey) throw new Error('group/key-taken')
    }
    const node: NodeRecord = {
      id: 'nd_' + randomBase32(12),
      name: frame.name,
      encKey: frame.encKey,
      signKey: frame.signKey,
      meta: frame.meta ?? {},
      createdAt: Date.now(),
      revokedAt: null,
    }
    target.nodes[node.id] = node
    token.uses += 1
    await persist()
    return {
      type: 'welcome',
      v: 1,
      nodeId: node.id,
      groupId: target.id,
      groupName: target.name,
      directory: directory(target.id),
      serverTime: Date.now(),
    }
  }

  const hello = (frame: HelloFrame): WelcomeFrame => {
    if (frame.v !== 1) throw new Error('protocol/version')
    if (!Number.isInteger(frame.ts) || Math.abs(Date.now() - frame.ts) > HELLO_WINDOW_MS) throw new Error('auth/unauthorized')
    const target = state.groups[frame.groupId]
    const node = target?.nodes[frame.nodeId]
    if (target === undefined || node === undefined) throw new Error('auth/unauthorized')
    if (node.revokedAt !== null) throw new Error('auth/revoked')
    if (!verifyProof(node.signKey, canonicalHello(frame.nodeId, frame.groupId, frame.ts, frame.nonce), frame.signature)) {
      throw new Error('auth/unauthorized')
    }
    const cache = nonces.get(frame.nodeId) ?? new Map<string, number>()
    const now = Date.now()
    for (const [nonce, at] of cache) if (now - at > HELLO_WINDOW_MS) cache.delete(nonce)
    if (cache.has(frame.nonce)) throw new Error('auth/unauthorized')
    cache.set(frame.nonce, now)
    nonces.set(frame.nodeId, cache)
    return {
      type: 'welcome',
      v: 1,
      nodeId: node.id,
      groupId: target.id,
      groupName: target.name,
      directory: directory(target.id),
      serverTime: now,
    }
  }

  /** Validate one Session status id and numeric fact set. */
  const validStatus = (sessionId: unknown, running: unknown, pending: unknown, unread: unknown, updatedAt: unknown): boolean => {
    return typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 200 &&
      typeof running === 'boolean' && (typeof pending === 'string' || pending === null) &&
      typeof unread === 'boolean' && typeof updatedAt === 'number' && Number.isFinite(updatedAt)
  }

  /** Publish one owner-authored status row to the group. */
  const publishStatus = (nodeId: string, groupIdToWrite: string, frame: StatusPublishFrame): void => {
    const groupToWrite = state.groups[groupIdToWrite]
    if (groupToWrite === undefined) return
    if (!validStatus(frame.sessionId, frame.running, frame.pending, frame.unread, frame.updatedAt)) return
    const existing = groupToWrite.statuses[frame.sessionId]
    if (existing !== undefined && existing.ownerNodeId !== nodeId) return
    const readAt = existing?.readAt ?? 0
    const unread = frame.running ? false : frame.unread && readAt < frame.updatedAt
    const record: SessionStatusRecord = {
      sessionId: frame.sessionId,
      ownerNodeId: nodeId,
      running: frame.running,
      pending: frame.pending,
      unread,
      updatedAt: frame.updatedAt,
      readAt,
      revision: (existing?.revision ?? 0) + 1,
    }
    groupToWrite.statuses[frame.sessionId] = record
    void persist().catch(() => {})
    const update: StatusStateFrame = { type: 'status.state', v: 1, status: record }
    broadcast(groupIdToWrite, update)
  }

  /** Record a read acknowledgement from any group member. */
  const readStatus = (groupIdToWrite: string, frame: StatusReadFrame): void => {
    const groupToWrite = state.groups[groupIdToWrite]
    if (groupToWrite === undefined || typeof frame.sessionId !== 'string') return
    const existing = groupToWrite.statuses[frame.sessionId]
    if (existing === undefined) return
    const readAt = Math.max(existing.readAt, Number.isFinite(frame.readAt) ? frame.readAt : 0, Date.now())
    const record: SessionStatusRecord = {
      ...existing,
      unread: false,
      readAt,
      revision: existing.revision + 1,
    }
    groupToWrite.statuses[frame.sessionId] = record
    void persist().catch(() => {})
    const update: StatusStateFrame = { type: 'status.state', v: 1, status: record }
    broadcast(groupIdToWrite, update)
  }

  /** Clear live facts for a node whose socket went away. */
  const markNodeOffline = (nodeId: string, groupIdToWrite: string): void => {
    const groupToWrite = state.groups[groupIdToWrite]
    if (groupToWrite === undefined) return
    let changed = false
    for (const [sessionId, existing] of Object.entries(groupToWrite.statuses)) {
      if (existing.ownerNodeId !== nodeId || (!existing.running && existing.pending === null)) continue
      const record: SessionStatusRecord = {
        ...existing,
        running: false,
        pending: null,
        updatedAt: Math.max(existing.updatedAt, Date.now()),
        revision: existing.revision + 1,
      }
      groupToWrite.statuses[sessionId] = record
      changed = true
      broadcast(groupIdToWrite, { type: 'status.state', v: 1, status: record })
    }
    if (changed) void persist().catch(() => {})
  }

  const dropRoutes = (nodeId: string): void => {
    for (const [id, route] of routes) {
      if (route.from === nodeId) {
        const target = connections.get(route.to)
        if (target !== undefined) {
          send(target.ws, { type: 'bridge.cancel', v: 1, id, to: route.to, from: nodeId })
        }
        routes.delete(id)
        continue
      }
      if (route.to !== nodeId) continue
      const requester = connections.get(route.from)
      if (requester !== undefined) {
        send(requester.ws, {
          type: 'bridge.error',
          v: 1,
          id,
          to: route.from,
          from: nodeId,
          error: { code: 'bridge/offline', message: 'Peer disconnected.' },
        })
      }
      routes.delete(id)
    }
  }

  const attach = (ws: WebSocket, frame: WelcomeFrame): void => {
    const connection: Connection = {
      ws,
      nodeId: frame.nodeId,
      groupId: frame.groupId,
      lastSeen: Date.now(),
      awaitingPong: false,
    }
    dropRoutes(frame.nodeId)
    connections.get(frame.nodeId)?.ws.close(4000, 'replaced')
    connections.set(frame.nodeId, connection)
    const welcome: WelcomeFrame = {
      ...frame,
      directory: directory(frame.groupId),
      statuses: Object.values(state.groups[frame.groupId]?.statuses ?? {}),
      serverTime: Date.now(),
    }
    send(ws, welcome)
    const node = state.groups[frame.groupId]?.nodes[frame.nodeId]
    if (node !== undefined) broadcast(frame.groupId, onlineEvent(node, 'node.online'), frame.nodeId)
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })
  wss.on('connection', (ws: WebSocket) => {
    let ready = false
    let nodeId: string | undefined
    let groupId: string | undefined

    ws.on('message', (data) => {
      const frame = parseFrame(data)
      if (frame === undefined) {
        fail(ws, 'protocol/invalid', 'Malformed frame.')
        return
      }
      if (!ready) {
        try {
          if (frame.type === 'register') {
            void register(frame).then((welcome) => {
              ready = true
              nodeId = welcome.nodeId
              groupId = welcome.groupId
              attach(ws, welcome)
            }).catch((error: unknown) => {
              fail(ws, error instanceof Error ? error.message : 'register/failed', 'Registration failed.')
            })
            return
          }
          if (frame.type === 'hello') {
            const welcome = hello(frame)
            ready = true
            nodeId = welcome.nodeId
            groupId = welcome.groupId
            attach(ws, welcome)
            return
          }
          fail(ws, 'auth/required', 'Register or hello first.')
        } catch (error) {
          fail(ws, error instanceof Error ? error.message : 'auth/unauthorized', 'Authentication failed.')
        }
        return
      }
      if (frame.type === 'pong') {
        const connection = nodeId === undefined ? undefined : connections.get(nodeId)
        if (connection !== undefined) {
          connection.awaitingPong = false
          connection.lastSeen = Date.now()
        }
        return
      }
      if (frame.type === 'status.publish') {
        if (nodeId !== undefined && groupId !== undefined) publishStatus(nodeId, groupId, frame)
        return
      }
      if (frame.type === 'status.read') {
        if (groupId !== undefined) readStatus(groupId, frame)
        return
      }
      if (
        frame.type === 'bridge.request' ||
        frame.type === 'bridge.response' ||
        frame.type === 'bridge.stream' ||
        frame.type === 'bridge.end' ||
        frame.type === 'bridge.error' ||
        frame.type === 'bridge.cancel'
      ) {
        routeBridge(ws, frame, nodeId, groupId)
        return
      }
      fail(ws, 'protocol/invalid', 'Unexpected frame.')
    })

    ws.on('close', () => {
      if (nodeId === undefined) return
      const connection = connections.get(nodeId)
      if (connection === undefined || connection.ws !== ws) return
      connections.delete(nodeId)
      dropRoutes(nodeId)
      if (groupId !== undefined) markNodeOffline(nodeId, groupId)
      const frame: NodeEventFrame = { type: 'node.offline', v: 1, nodeId }
      if (groupId !== undefined) broadcast(groupId, frame)
    })

    ws.on('error', () => {
      // The close event owns presence cleanup.
    })
  })

  const routeBridge = (ws: WebSocket, frame: BridgeFrame, nodeId?: string, groupId?: string): void => {
    if (nodeId === undefined || groupId === undefined) return
    if (
      typeof frame.id !== 'string' || frame.id.length === 0 || frame.id.length > 200 ||
      typeof frame.to !== 'string' || frame.to.length === 0 || frame.to.length > 100
    ) {
      fail(ws, 'protocol/invalid', 'Malformed bridge frame.')
      return
    }
    if (frame.type === 'bridge.response' || frame.type === 'bridge.end' || frame.type === 'bridge.error' || frame.type === 'bridge.cancel') {
      routes.delete(frame.id)
    }
    const target = connections.get(frame.to)
    if (target === undefined || target.groupId !== groupId || target.nodeId === nodeId) {
      if (frame.type === 'bridge.request') {
        const error: BridgeErrorFrame = {
          type: 'bridge.error',
          v: 1,
          id: frame.id,
          to: frame.to,
          from: frame.to,
          error: { code: 'bridge/offline', message: 'Peer is offline.' },
        }
        send(ws, error)
      }
      return
    }
    if (frame.type === 'bridge.request') routes.set(frame.id, { from: nodeId, to: frame.to })
    send(target.ws, { ...frame, from: nodeId } as BridgeFrame)
  }

  /** Public group bootstrap: a server token may create a new empty group. */
  const handlePublic = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.url === '/healthz') {
      json(response, 200, {
        ok: true,
        v: 1,
        groups: Object.keys(state.groups).length,
        nodes: Object.values(state.groups).reduce((sum, item) => sum + Object.keys(item.nodes).length, 0),
        online: connections.size,
      })
      return
    }
    if (request.method === 'POST' && request.url === '/v1/groups') {
      try {
        const body = await readBody(request) as { token?: unknown }
        const tokenRecord = typeof body.token === 'string' ? resolveToken(state, body.token) : undefined
        if (tokenRecord === undefined || tokenRecord.revokedAt !== null ||
          (tokenRecord.expiresAt !== 0 && tokenRecord.expiresAt < Date.now())) {
          json(response, 401, { error: 'token/invalid' })
          return
        }
        const group = await createGroup()
        json(response, 201, { groupId: group.id })
      } catch (error) {
        json(response, 400, { error: 'group/create-failed', message: error instanceof Error ? error.message : 'invalid body' })
      }
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
  }

  const httpServer: HttpServer = createServer((request, response) => {
    void handlePublic(request, response)
  })

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== '/v1/node') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request))
  })

  const heartbeat = setInterval(() => {
    const now = Date.now()
    for (const connection of connections.values()) {
      if (connection.awaitingPong) {
        connection.ws.close(4001, 'ping timeout')
        continue
      }
      connection.awaitingPong = true
      send(connection.ws, { type: 'ping' })
      if (now - connection.lastSeen > ONLINE_WINDOW_MS) connection.ws.close(4001, 'presence timeout')
    }
  }, 15_000)

  const admin = createServer((request, response) => {
    void handleAdmin(request, response)
  })

  const handleAdmin = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (request.method === 'GET' && url.pathname === '/admin/status') {
        json(response, 200, {
          v: 1,
          groups: Object.values(state.groups).map((item) => ({ id: item.id, name: item.name, nodes: Object.keys(item.nodes).length })),
          online: connections.size,
        })
        return
      }
      if (request.method === 'GET' && url.pathname === '/admin/groups') {
        json(response, 200, { groups: Object.values(state.groups).map((item) => ({ id: item.id, name: item.name })) })
        return
      }
      if (request.method === 'POST' && url.pathname === '/admin/tokens') {
        const body = await readBody(request) as { ttlMs?: number; uses?: number }
        const minted = mintToken()
        const record: TokenRecord = {
          ...minted.record,
          expiresAt: typeof body.ttlMs === 'number' && body.ttlMs > 0 ? Date.now() + body.ttlMs : 0,
          maxUses: typeof body.uses === 'number' && body.uses > 0 ? body.uses : 0,
        }
        state.tokens[record.id] = record
        await persist()
        json(response, 200, { token: minted.token, tokenId: record.id })
        return
      }
      if (request.method === 'POST' && url.pathname === '/admin/groups') {
        const created = await createGroup()
        json(response, 201, { groupId: created.id })
        return
      }
      const nodesMatch = /^\/admin\/groups\/([^/]+)\/nodes$/.exec(url.pathname)
      if (request.method === 'GET' && nodesMatch !== null) {
        const target = state.groups[nodesMatch[1] ?? '']
        if (target === undefined) {
          json(response, 404, { error: 'group/not-found' })
          return
        }
        json(response, 200, {
          nodes: Object.values(target.nodes).map((node) => ({
            nodeId: node.id,
            name: node.name,
            online: connections.has(node.id),
            lastSeen: connections.get(node.id)?.lastSeen ?? 0,
            revokedAt: node.revokedAt,
          })),
        })
        return
      }
      const revokeMatch = /^\/admin\/nodes\/([^/]+)\/revoke$/.exec(url.pathname)
      if (request.method === 'POST' && revokeMatch !== null) {
        const id = revokeMatch[1] ?? ''
        for (const group of Object.values(state.groups)) {
          const node = group.nodes[id]
          if (node === undefined) continue
          node.revokedAt = Date.now()
          connections.get(id)?.ws.close(4002, 'revoked')
          await persist()
          json(response, 200, { revoked: true })
          return
        }
        json(response, 404, { error: 'admin/not-found' })
        return
      }
      json(response, 404, { error: 'admin/not-found' })
    } catch (error) {
      json(response, 500, { error: 'internal', message: error instanceof Error ? error.message : 'internal' })
    }
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject)
      resolve()
    })
  })
  await new Promise<void>((resolve, reject) => {
    admin.once('error', reject)
    admin.listen(adminPort, '127.0.0.1', () => {
      admin.off('error', reject)
      resolve()
    })
  })

  return {
    groupId,
    groupName: group.name,
    token,
    async close() {
      clearInterval(heartbeat)
      for (const connection of connections.values()) connection.ws.close(1001, 'server stopping')
      wss.close()
      await Promise.all([
        new Promise<void>((resolve) => httpServer.close(() => resolve())),
        new Promise<void>((resolve) => admin.close(() => resolve())),
      ])
      await persist()
    },
  }
}
