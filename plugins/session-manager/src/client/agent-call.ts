/**
 * Which Remote calls a federated Session must have answered by its owner.
 *
 * The browser's Host resolves a *local* Agent before a non-`session` endpoint runs, and a federated
 * row has none, so `@` candidates, the `/` catalog, a Session's skills list, and the file reads a
 * reference chip opens all came back empty or wrong for a peer Session. Those calls carry the
 * Session identity in the payload under one of a few wire names, which is what lets one interceptor
 * cover every such endpoint.
 *
 * The `session` namespace is deliberately excluded: the Host half already federates the Session
 * Controller, so forwarding those calls again would route the same work twice.
 *
 * Kept apart from React and the transport so the routing rule can be tested on its own.
 * @module dsh-plugin-session-manager/client/agent-call
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Wire argument names that carry a Session identity.
 *
 * `agentId` names the Agent-scoped endpoints, `sessionId` the Session-scoped ones, and
 * `workspaceFileScopeId` the file reads and listings behind a reference chip.
 */
const SESSION_KEYS = ['agentId', 'sessionId', 'workspaceFileScopeId'] as const

/**
 * Whether the Host half already federates one endpoint.
 * @param endpoint - channel-relative endpoint such as `session/prompt`.
 * @returns true for the whole `session` namespace, which the Host serves for peer rows.
 */
export function federatedByHost(endpoint: string): boolean {
  return endpoint === 'session' || endpoint.startsWith('session/')
}

/**
 * The Session one Remote payload speaks for, when a peer could own it.
 * @param endpoint - channel-relative endpoint such as `commands/list`.
 * @param payload - the `/api` payload, whose named arguments sit under `args`.
 * @returns the named Session, or undefined when the Host already serves the call.
 */
export function payloadSession(endpoint: string, payload: unknown): SessionId | undefined {
  if (federatedByHost(endpoint)) return undefined
  // Raw bytes cannot ride a JSON bridge: they arrive as an index-keyed object, not a Uint8Array.
  if (endpoint === 'workspaceFiles/readBytes') return undefined
  const args = (payload as { readonly args?: Readonly<Record<string, unknown>> } | undefined)?.args
  if (args === undefined) return undefined
  for (const key of SESSION_KEYS) {
    const value = args[key]
    if (typeof value === 'string') return value as SessionId
  }
  // A few endpoints wrap their scope in a `request` value instead of naming it directly.
  const request = args['request'] as Readonly<Record<string, unknown>> | undefined
  if (request === undefined) return undefined
  for (const key of SESSION_KEYS) {
    const value = request[key]
    if (typeof value === 'string') return value as SessionId
  }
  return undefined
}
