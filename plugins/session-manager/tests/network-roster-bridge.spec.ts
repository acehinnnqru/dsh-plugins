import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionListValue, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { startServer, type RunningServer } from '../server/src/server.ts'
import type { FederationEvents } from '../src/network/federation.ts'
import { NodeRuntime, type NetworkConfig, type PeerHooks } from '../src/network/node-runtime.ts'
import { rosterStream } from '../src/network/roster.ts'

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

/** One summary row. */
function summary(sessionId: string, title: string): SessionSummary {
  return {
    agentAvailable: true,
    sessionId: sessionId as SessionId,
    updatedAt: 1,
    running: false,
    blank: false,
    cwd: 'source',
    projections: { kind: 'sequenced', asOfSeq: 0, values: { title } },
  }
}

/**
 * One controller with one local row and the methods federation installs around.
 *
 * A fresh class per call keeps each instance on its own prototype: federation
 * wraps the prototype, and two nodes sharing one class would wrap each other.
 */
function controller(rows: readonly SessionSummary[]): {
  list(request?: unknown): Promise<SessionListValue>
  follow(): AsyncIterable<never>
} {
  return new (class {
    async list(_request?: unknown): Promise<SessionListValue> {
      return { items: rows }
    }

    async *follow(): AsyncIterable<never> {
      yield* [] as never[]
    }
  })()
}

/** Poll until `ready` returns a value. */
async function waitFor<T>(ready: () => T | undefined, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = ready()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('condition timed out')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** Hooks over one controller: its local rows are the roster, and changes are recorded. */
function hooksFor(target: { list(): Promise<SessionListValue> }, added: SessionSummary[]): PeerHooks {
  // Captured before federation wraps the prototype, exactly like the plugin does.
  const local = target.list.bind(target)
  const events: FederationEvents = {
    isLocal: () => false,
    added: (value) => added.push(value),
    removed: () => {},
    status: () => {},
    activity: () => {},
  }
  return {
    events,
    roster: (signal) => rosterStream({
      list: () => local(),
      subscribe: () => () => {},
    }, signal),
  }
}

/** Rows node A received from a peer roster. */
const addedRows: SessionSummary[] = []

describe('peer roster over the server bridge', () => {
  let server: RunningServer
  let a: NodeRuntime
  let b: NodeRuntime
  let controllerA: { list(request?: unknown): Promise<SessionListValue> }
  let stateDir: string
  let homeA: string
  let homeB: string

  beforeAll(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'session-manager-roster-state-'))
    homeA = await mkdtemp(join(tmpdir(), 'session-manager-roster-a-'))
    homeB = await mkdtemp(join(tmpdir(), 'session-manager-roster-b-'))
    const port = await freePort()
    const adminPort = await freePort()
    server = await startServer({ listen: { host: '127.0.0.1', port }, adminPort, stateDir, group: 'roster' })
    const config = (name: string): NetworkConfig => ({
      server: 'ws://127.0.0.1:' + String(port),
      token: server.token ?? '',
      name,
      group: '',
    })
    process.env['DSH_HOME'] = homeA
    controllerA = controller([summary('01A', 'local')])
    a = new NodeRuntime(config('node-a'), controllerA, () => {}, undefined, undefined, hooksFor(controllerA, addedRows))
    await a.start()
    process.env['DSH_HOME'] = homeB
    const controllerB = controller([summary('01B', 'peer')])
    b = new NodeRuntime(config('node-b'), controllerB, () => {}, undefined, undefined, hooksFor(controllerB, []))
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

  it('reports the peer row without asking the peer for a listing', async () => {
    const added = await waitFor(() => addedRows.find((row) => row.sessionId === '01B'))
    const values = added.projections?.values as Readonly<Record<string, unknown>> | undefined
    expect(values?.['title']).toBe('[node-b] peer')
    expect(values?.['sessionManagerNode']).toMatchObject({ nodeId: expect.any(String), name: 'node-b' })

    const listed = await controllerA.list({})
    expect(listed.items.map((item) => item.sessionId).sort()).toEqual(['01A', '01B'])
    const remote = listed.items.find((item) => item.sessionId === '01B')
    const remoteValues = remote?.projections?.values as Readonly<Record<string, unknown>> | undefined
    expect(remoteValues?.['title']).toBe('[node-b] peer')
  })
})
