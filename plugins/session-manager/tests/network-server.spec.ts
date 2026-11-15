import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { canonicalRegister, type ServerFrame, type WelcomeFrame } from '../server/src/protocol.ts'
import { startServer, type RunningServer } from '../server/src/server.ts'

/** One free TCP port. */
async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/** Raw public key bytes. */
function raw(publicKey: ReturnType<typeof generateKeyPairSync>['publicKey']): string {
  const der = publicKey.export({ format: 'der', type: 'spki' })
  return Buffer.from(der.subarray(der.length - 32)).toString('base64url')
}

/** Register one fake node and keep its socket open. */
async function register(
  url: string,
  token: string,
  name: string,
  groupId?: string,
  instanceId?: string,
): Promise<{ welcome: WelcomeFrame; socket: WebSocket }> {
  const signing = generateKeyPairSync('ed25519')
  const encryption = generateKeyPairSync('x25519')
  const encKey = raw(encryption.publicKey)
  const signKey = raw(signing.publicKey)
  const socket = new WebSocket(url)
  const welcome = await new Promise<WelcomeFrame>((resolve, reject) => {
    socket.on('open', () => {
      const ts = Date.now()
      const proof = sign(null, Buffer.from(canonicalRegister(name, encKey, signKey, ts)), signing.privateKey).toString('base64url')
      socket.send(JSON.stringify({
        type: 'register',
        v: 1,
        token,
        name,
        encKey,
        signKey,
        ts,
        proof,
        ...(groupId === undefined ? {} : { groupId }),
        ...(instanceId === undefined ? {} : { instanceId }),
      }))
    })
    socket.on('message', (data) => {
      const frame = JSON.parse((data as Buffer).toString('utf8')) as ServerFrame
      if (frame.type === 'welcome') resolve(frame)
      if (frame.type === 'error') reject(new Error(frame.code))
    })
    socket.on('error', reject)
  })
  return { welcome, socket }
}

/** Wait for one frame that matches a predicate. */
function nextFrame(socket: WebSocket, predicate: (frame: ServerFrame) => boolean): Promise<ServerFrame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage)
      reject(new Error('frame timeout'))
    }, 2000)
    const onMessage = (data: unknown): void => {
      const frame = JSON.parse((data as Buffer).toString('utf8')) as ServerFrame
      if (!predicate(frame)) return
      clearTimeout(timer)
      socket.off('message', onMessage)
      resolve(frame)
    }
    socket.on('message', onMessage)
  })
}

describe('session-manager server', () => {
  let server: RunningServer
  let stateDir: string
  let url: string
  let health: string
  let admin: string

  beforeAll(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'session-manager-server-'))
    const port = await freePort()
    const adminPort = await freePort()
    server = await startServer({
      listen: { host: '127.0.0.1', port },
      adminPort,
      stateDir,
      group: 'test',
    })
    url = 'ws://127.0.0.1:' + String(port) + '/v1/node'
    health = 'http://127.0.0.1:' + String(port) + '/healthz'
    admin = 'http://127.0.0.1:' + String(adminPort)
  })

  afterAll(async () => {
    await server.close()
    await rm(stateDir, { recursive: true, force: true })
  })

  it('registers two nodes and publishes the directory', async () => {
    expect(server.token).toBeDefined()
    const a = await register(url, server.token ?? '', 'node-a')
    const b = await register(url, server.token ?? '', 'node-b')
    expect(a.welcome.groupId).toBe(server.groupId)
    expect(b.welcome.groupId).toBe(server.groupId)
    const directory = b.welcome.directory
    expect(directory.find((peer) => peer.name === 'node-a')?.online).toBe(true)
    expect(directory.find((peer) => peer.name === 'node-b')?.online).toBe(true)
    a.socket.close()
    b.socket.close()
  })

  it('answers health and admin status', async () => {
    const value = await (await fetch(health)).json() as { online: number; groups: number }
    expect(value.groups).toBe(1)
    expect(value.online).toBeGreaterThanOrEqual(0)
    const status = await (await fetch(admin + '/admin/status')).json() as { groups: unknown[] }
    expect(status.groups).toHaveLength(1)
  })

  it('bridges one request and its response between two nodes', async () => {
    const a = await register(url, server.token ?? '', 'bridge-a')
    const b = await register(url, server.token ?? '', 'bridge-b')
    const id = a.welcome.nodeId + ':one'

    const requestFrame = nextFrame(b.socket, (frame) => frame.type === 'bridge.request' && frame.id === id)
    a.socket.send(JSON.stringify({
      type: 'bridge.request',
      v: 1,
      id,
      to: b.welcome.nodeId,
      op: 'session.list',
      args: {},
    }))
    const request = await requestFrame
    if (request.type !== 'bridge.request') throw new Error('wrong frame')
    expect(request.from).toBe(a.welcome.nodeId)
    expect(request.op).toBe('session.list')

    const responseFrame = nextFrame(a.socket, (frame) => frame.type === 'bridge.response' && frame.id === id)
    b.socket.send(JSON.stringify({
      type: 'bridge.response',
      v: 1,
      id,
      to: a.welcome.nodeId,
      ok: true,
      value: { items: [] },
    }))
    const response = await responseFrame
    if (response.type !== 'bridge.response') throw new Error('wrong frame')
    expect(response.ok).toBe(true)
    expect(response.from).toBe(b.welcome.nodeId)

    const errorFrame = nextFrame(a.socket, (frame) => frame.type === 'bridge.error')
    a.socket.send(JSON.stringify({
      type: 'bridge.request',
      v: 1,
      id: a.welcome.nodeId + ':missing',
      to: 'nd_missing',
      op: 'session.list',
      args: {},
    }))
    const error = await errorFrame
    if (error.type !== 'bridge.error') throw new Error('wrong frame')
    expect(error.error.code).toBe('bridge/offline')

    const streamId = a.welcome.nodeId + ':stream'
    const streamRequest = nextFrame(b.socket, (frame) => frame.type === 'bridge.request' && frame.id === streamId)
    a.socket.send(JSON.stringify({
      type: 'bridge.request',
      v: 1,
      id: streamId,
      to: b.welcome.nodeId,
      op: 'session.follow',
      args: { sessionId: '01S' },
    }))
    await streamRequest
    const cancelFrame = nextFrame(b.socket, (frame) => frame.type === 'bridge.cancel' && frame.id === streamId)
    a.socket.close()
    const cancel = await cancelFrame
    if (cancel.type !== 'bridge.cancel') throw new Error('wrong frame')
    expect(cancel.from).toBe(a.welcome.nodeId)
    b.socket.close()
  })

  it('shares an unread completion and clears it from any reader', async () => {
    const a = await register(url, server.token ?? '', 'status-a')
    const b = await register(url, server.token ?? '', 'status-b')
    const sessionId = '01STATUSSHARED'

    const pushed = nextFrame(b.socket, (frame) => frame.type === 'status.state' && frame.status.sessionId === sessionId)
    a.socket.send(JSON.stringify({
      type: 'status.publish',
      v: 1,
      sessionId,
      running: false,
      pending: 'approval',
      unread: true,
      updatedAt: 1000,
    }))
    const published = await pushed
    if (published.type !== 'status.state') throw new Error('wrong frame')
    expect(published.status.ownerNodeId).toBe(a.welcome.nodeId)
    expect(published.status.unread).toBe(true)
    expect(published.status.pending).toBe('approval')

    const cleared = nextFrame(a.socket, (frame) => frame.type === 'status.state' && frame.status.sessionId === sessionId && !frame.status.unread)
    b.socket.send(JSON.stringify({ type: 'status.read', v: 1, sessionId, readAt: 2000 }))
    const read = await cleared
    if (read.type !== 'status.state') throw new Error('wrong frame')
    expect(read.status.readAt).toBeGreaterThanOrEqual(2000)

    const c = await register(url, server.token ?? '', 'status-c')
    expect(c.welcome.statuses?.find((status) => status.sessionId === sessionId)?.unread).toBe(false)
    a.socket.close()
    b.socket.close()
    c.socket.close()
  })

  it('creates a group from a server token and joins it by id', async () => {
    const host = 'http://127.0.0.1:' + String(new URL(url).port)
    const createdResponse = await fetch(host + '/v1/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: server.token ?? '' }),
    })
    expect(createdResponse.status).toBe(201)
    const created = await createdResponse.json() as { groupId: string }
    expect(created.groupId).toMatch(/^grp_/)

    const a = await register(url, server.token ?? '', 'team-a', created.groupId)
    const b = await register(url, server.token ?? '', 'team-b', created.groupId)
    expect(a.welcome.groupId).toBe(created.groupId)
    expect(b.welcome.groupId).toBe(created.groupId)
    expect(b.welcome.directory.map((peer) => peer.name).sort()).toEqual(['team-a', 'team-b'])

    const other = await register(url, server.token ?? '', 'team-other')
    expect(other.welcome.groupId).toBe(server.groupId)
    expect(other.welcome.directory.some((peer) => peer.name === 'team-a')).toBe(false)

    a.socket.close()
    b.socket.close()
    other.socket.close()
  })

  it('keeps one node id for one installation hash', async () => {
    const instanceId = 'nid_' + 'a'.repeat(64)
    const first = await register(url, server.token ?? '', 'install-a', undefined, instanceId)
    const second = await register(url, server.token ?? '', 'install-a', first.welcome.groupId, instanceId)
    expect(second.welcome.nodeId).toBe(first.welcome.nodeId)
    expect(second.welcome.directory.filter((peer) => peer.name === 'install-a')).toHaveLength(1)
    expect(second.welcome.directory.find((peer) => peer.name === 'install-a')?.instanceId).toBe(instanceId)
    first.socket.close()
    second.socket.close()
  })
})
