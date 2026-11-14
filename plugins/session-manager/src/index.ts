/**
 * `dsh-plugin-session-manager`, host half.
 *
 * The board is browser-only. This half contributes the optional network runtime:
 * it keeps one WebSocket to the directory server, bridges peer Session RPC over
 * that socket, and federates remote Sessions into the ordinary Session
 * Controller surface. It also owns the shared read/unread record that the
 * browser status route exposes.
 * @module dsh-plugin-session-manager
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import z from '@deepseek-ai/schemastery'
import { NodeRuntime, type NetworkConfig } from './network/node-runtime.ts'
import { StatusCoordinator } from './network/status.ts'
import type { SessionStatusRecord } from './network/protocol.ts'

/** Loader metadata: the name shown in fiber diagnostics and logs. */
export const name = 'session-manager'

/** Loader metadata: the network runtime calls the Host Session Controller from this fiber. */
export const inject = [
  'sessionController',
  'agentDefaultModel',
  'agents',
  'attachments',
  'fileUploads',
  'fs',
  'llm',
  'remoteAccess',
  'sessions',
  'sessionProjections',
  'sessionQuery',
  'typert',
  'typertGateway',
  'workspaceRegistry',
]

/**
 * Deployment configuration. Network fields are volatile because the settings
 * dialog edits them live; each value is read through {@link Volatile.get}.
 */
export interface Config {
  /** Directory server URL, for example `ws://127.0.0.1:8787`. Empty disables networking. */
  server: Volatile<string>
  /** Join token used only for the first registration. */
  token: Volatile<string>
  /** Node name shown to peers; the host name when empty. */
  name: Volatile<string>
}

/** Schemastery schema for {@link Config}. */
export const Config = z.object({
  server: z.string().default('').volatile(),
  token: z.string().default('').volatile(),
  name: z.string().default('').volatile(),
})

/** Read one schema field, accepting both live refs and plain test fixtures. */
function readString(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'get' in value) {
    const result = (value as { get(): unknown }).get()
    if (typeof result === 'string') return result
  }
  return fallback
}

/** One JSON response. */
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/**
 * Host plugin body.
 * @param ctx - Host context.
 * @param config - resolved network configuration.
 */
export function apply(ctx: Context, config?: Config): void {
  const env = process.env
  const resolved: NetworkConfig = {
    server: readString(config?.server, '') || env['SM_SERVER'] || '',
    token: readString(config?.token, '') || env['SM_TOKEN'] || '',
    name: readString(config?.name, '') || env['SM_NAME'] || '',
  }
  if (resolved.server.length === 0) return
  ctx.inject(['sessionController'], (scope) => {
    const controller = scope.get('sessionController') as {
      list?: (request: unknown, signal: AbortSignal) => Promise<SessionListValue>
      state?: (request: { sessionId: SessionId }, signal: AbortSignal) => Promise<{ running: boolean; pendingInput: readonly { kind: string }[] }>
    } | undefined
    if (controller === undefined || typeof controller.list !== 'function' || typeof controller.state !== 'function') return

    // Capture the pre-federation methods: local status must never include peer rows.
    const localList = controller.list
    const localState = controller.state
    const coordinator = new StatusCoordinator({
      list: () => localList.call(controller, {}, new AbortController().signal),
      state: (sessionId) => localState.call(controller, { sessionId }, new AbortController().signal),
    }, (message) => ctx.logger.info(message))

    let runtime: NodeRuntime | undefined
    const disposeRuntime = (): void => {
      runtime?.close()
      runtime = undefined
    }
    scope.effect(() => () => {
      coordinator.stop()
      disposeRuntime()
    }, 'session-manager: status runtime')

    if (resolved.server.length > 0) {
      runtime = new NodeRuntime(
        resolved,
        controller,
        (message) => ctx.logger.info(message),
        (statuses) => {
          // The welcome snapshot lands before any local publication, so a restart cannot
          // clear an unread mark that another reader already acknowledged.
          coordinator.applyServer(statuses)
          coordinator.setPublisher({
            publish: (status) => runtime?.publishStatus(status),
            read: (sessionId, readAt) => runtime?.publishRead(sessionId, readAt),
          })
          coordinator.publishAll()
          coordinator.start()
        },
        (status) => coordinator.applyOne(status),
      )
      void runtime.start().catch((error: unknown) => {
        ctx.logger.warn('session-manager: network start failed: ' + (error instanceof Error ? error.message : String(error)))
      })
    }
    scope.effect(() => ctx.on('api-session/status', (sessionId, running) => {
      coordinator.onRunning(sessionId as string, running)
    }), 'session-manager: local running edges')

    // Status routes ride the authenticated /api channel; only the owner browser reaches them.
    scope.inject(['connection'], (web) => {
      const connection = web.get('connection') as {
        fetch: {
          register(route: {
            path: string
            methods: readonly ('GET' | 'POST')[]
            requestBody: 'buffered'
            fetch(request: Request): Promise<Response>
          }): () => Promise<void>
        }
      } | undefined
      if (connection === undefined) return
      const route = (path: string, methods: readonly ('GET' | 'POST')[], fetch: (request: Request) => Promise<Response>) =>
        connection.fetch.register({ path, methods, requestBody: 'buffered', fetch })
      web.effect(() => route('/api/session-manager/status', ['GET'], async () => json({
        v: 1,
        statuses: coordinator.snapshot() as readonly SessionStatusRecord[],
      })), 'session-manager: status route')
      web.effect(() => route('/api/session-manager/read', ['POST'], async (request) => {
        const body = await request.json() as { sessionId?: unknown }
        if (typeof body.sessionId !== 'string' || body.sessionId.length === 0) return json({ error: 'sessionId required' }, 400)
        coordinator.markRead(body.sessionId as SessionId)
        return new Response(null, { status: 204 })
      }), 'session-manager: read route')
      web.effect(() => route('/api/session-manager/report', ['POST'], async (request) => {
        const body = await request.json() as { sessionId?: unknown; updatedAt?: unknown }
        if (typeof body.sessionId !== 'string' || typeof body.updatedAt !== 'number') return json({ error: 'sessionId and updatedAt required' }, 400)
        await coordinator.reportUnread(body.sessionId as SessionId, body.updatedAt)
        return new Response(null, { status: 204 })
      }), 'session-manager: report route')
    })
  })
}
