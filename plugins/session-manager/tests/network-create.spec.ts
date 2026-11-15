import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { startServer, type RunningServer } from '../server/src/server.ts'
import { NodeRuntime, type NetworkConfig } from '../src/network/node-runtime.ts'

/** One free port. */
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

/** A controller with only the methods the federation and create path need. */
class FakeController {
  readonly created: string[] = []

  async list(): Promise<{ items: never[] }> {
    return { items: [] }
  }

  async *follow(): AsyncIterable<never> {
    yield* [] as never[]
  }

  async create(request: { readonly cwd: string }): Promise<{ readonly sessionId: SessionId }> {
    this.created.push(request.cwd)
    return { sessionId: ('created-' + String(this.created.length)) as SessionId }
  }
}

/** Poll until `ready` returns a value. */
async function waitFor<T>(ready: () => T | undefined, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = ready()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('condition timed out')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

describe('remote new-session bridge', () => {
  let server: RunningServer
  let a: NodeRuntime
  let b: NodeRuntime
  let controllerB: FakeController
  let stateDir: string
  let homeA: string
  let homeB: string

  beforeAll(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'session-manager-create-state-'))
    homeA = await mkdtemp(join(tmpdir(), 'session-manager-create-a-'))
    homeB = await mkdtemp(join(tmpdir(), 'session-manager-create-b-'))
    const port = await freePort()
    const adminPort = await freePort()
    server = await startServer({ listen: { host: '127.0.0.1', port }, adminPort, stateDir, group: 'test' })
    const config = (name: string): NetworkConfig => ({
      server: 'ws://127.0.0.1:' + String(port),
      token: server.token ?? '',
      name,
      group: '',
    })
    process.env['DSH_HOME'] = homeA
    a = new NodeRuntime(config('node-a'), new FakeController(), () => {})
    await a.start()
    process.env['DSH_HOME'] = homeB
    controllerB = new FakeController()
    b = new NodeRuntime(config('node-b'), controllerB, () => {})
    await b.start()
  })

  afterAll(async () => {
    a.close()
    b.close()
    await server.close()
    delete process.env['DSH_HOME']
    await rm(stateDir, { recursive: true, force: true })
    await rm(homeA, { recursive: true, force: true })
    await rm(homeB, { recursive: true, force: true })
  })

  it('creates a blank on the selected peer', async () => {
    const peer = await waitFor(() => a.nodes().find((node) => !node.self && node.name === 'node-b'))
    expect(peer.nodeId).toBeDefined()
    const value = await a.createSession(peer.nodeId as string, { cwd: '/work/new' })
    expect(value.sessionId).toBe('created-1')
    expect(controllerB.created).toEqual(['/work/new'])
  })
})
