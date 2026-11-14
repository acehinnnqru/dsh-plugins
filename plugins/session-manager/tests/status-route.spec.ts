import { afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, type Config } from '../src/index.ts'
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

/** A controller with one idle Session and the two methods federation installs around. */
class FakeController {
  async list(): Promise<unknown> {
    return {
      items: [{ sessionId: '01ROUTE', updatedAt: 100, running: false, blank: false, agentAvailable: false, retainedBy: {} }],
    }
  }

  async *follow(): AsyncGenerator<unknown> {}

  async state(): Promise<{ running: boolean; pendingInput: readonly { kind: string }[] }> {
    return { running: false, pendingInput: [] }
  }
}

/** Wait until a read produces the wanted value. */
async function waitFor<T>(read: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('condition timeout')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('status route', () => {
  let server: RunningServer | undefined
  let stateDir: string | undefined
  const priorHome = process.env['DSH_HOME']

  afterAll(async () => {
    if (priorHome === undefined) delete process.env['DSH_HOME']
    else process.env['DSH_HOME'] = priorHome
    await server?.close()
    if (stateDir !== undefined) await rm(stateDir, { recursive: true, force: true })
  })

  it('registers an authenticated status route and publishes the local row', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'session-manager-status-'))
    process.env['DSH_HOME'] = join(stateDir, 'home')
    const port = await freePort()
    const adminPort = await freePort()
    server = await startServer({ listen: { host: '127.0.0.1', port }, adminPort, stateDir, group: 'route' })

    const controller = new FakeController()
    const routes = new Map<string, { fetch(request: Request): Promise<Response> }>()
    const disposers: (() => void)[] = []
    const connection = {
      fetch: {
        register(route: { path: string; fetch(request: Request): Promise<Response> }) {
          routes.set(route.path, route)
          return async () => {}
        },
      },
    }
    const webScope = {
      get: (name: string) => name === 'connection' ? connection : undefined,
      effect: (callback: () => unknown) => {
        const dispose = callback()
        if (typeof dispose === 'function') disposers.push(dispose as () => void)
        return () => {}
      },
    }
    const scope = {
      get: (name: string) => name === 'sessionController' ? controller : undefined,
      inject: (deps: string[], callback: (web: typeof webScope) => void) => {
        if (deps[0] === 'connection') callback(webScope)
        return () => {}
      },
      effect: (callback: () => unknown) => {
        const dispose = callback()
        if (typeof dispose === 'function') disposers.push(dispose as () => void)
        return () => {}
      },
      on: () => () => {},
    }
    const ctx = {
      inject: (deps: string[], callback: (value: unknown) => void) => {
        if (deps[0] === 'connection') callback(webScope)
        if (deps[0] === 'sessionController') callback(scope)
        return () => {}
      },
      on: () => () => {},
      logger: { info: () => {}, warn: () => {} },
      get: () => undefined,
    }
    apply(ctx as never, {
      server: 'ws://127.0.0.1:' + String(port),
      token: server.token ?? '',
      name: 'status-route',
    } as unknown as Config)

    const route = await waitFor(() => routes.get('/api/session-manager/status'))
    const deadline = Date.now() + 3000
    let row: { sessionId: string; running: boolean; unread: boolean } | undefined
    while (row === undefined && Date.now() < deadline) {
      const current = await route.fetch(new Request('http://127.0.0.1/api/session-manager/status'))
      const body = await current.json() as { statuses?: readonly { sessionId: string; running: boolean; unread: boolean }[] }
      row = body.statuses?.find((status) => status.sessionId === '01ROUTE')
      if (row === undefined) await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(row).toMatchObject({ sessionId: '01ROUTE', running: false, unread: false })

    const groupRoute = await waitFor(() => routes.get('/api/session-manager/group'))
    const groupResponse = await groupRoute.fetch(new Request('http://127.0.0.1/api/session-manager/group', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ server: 'ws://127.0.0.1:' + String(port), token: server.token ?? '' }),
    }))
    const created = await groupResponse.json() as { groupId?: string }
    expect(created.groupId).toMatch(/^grp_/)

    const readRoute = await waitFor(() => routes.get('/api/session-manager/read'))
    const read = await readRoute.fetch(new Request('http://127.0.0.1/api/session-manager/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: '01ROUTE' }),
    }))
    expect(read.status).toBe(204)
    for (const dispose of disposers.reverse()) dispose()
    await server.close()
    server = undefined
  })
})
