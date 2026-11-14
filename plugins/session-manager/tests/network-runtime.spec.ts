import { afterAll, beforeAll, describe, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionListValue, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/types'
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

/** One local summary. */
function summary(): SessionSummary {
  return {
    agentAvailable: true,
    sessionId: '01LOCAL' as SessionId,
    updatedAt: 1,
    running: false,
    blank: false,
    cwd: 'source',
    projections: { kind: 'sequenced', asOfSeq: 0, values: {} },
  }
}

describe('network runtime registration', () => {
  let server: RunningServer
  let runtime: NodeRuntime
  let stateDir: string
  let home: string
  let admin: string

  beforeAll(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'session-manager-state-'))
    home = await mkdtemp(join(tmpdir(), 'session-manager-home-'))
    const port = await freePort()
    const adminPort = await freePort()
    server = await startServer({ listen: { host: '127.0.0.1', port }, adminPort, stateDir, group: 'test' })
    admin = 'http://127.0.0.1:' + String(adminPort)
    process.env['DSH_HOME'] = home
    const controller = {
      async list(): Promise<SessionListValue> {
        return { items: [summary()] }
      },
      async *follow(): AsyncIterable<never> {
        yield* [] as never[]
      },
    }
    const config: NetworkConfig = {
      server: 'ws://127.0.0.1:' + String(port),
      token: server.token ?? '',
      name: 'node-a',
    }
    runtime = new NodeRuntime(config, controller, () => {})
    await runtime.start()
  })

  afterAll(async () => {
    runtime.close()
    await server.close()
    delete process.env['DSH_HOME']
    await rm(stateDir, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  })

  it('registers with the server and exposes local rows', async () => {
    const deadline = Date.now() + 4000
    for (;;) {
      const status = await (await fetch(admin + '/admin/status')).json() as { online: number }
      if (status.online === 1) break
      if (Date.now() > deadline) throw new Error('node did not come online')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })
})
