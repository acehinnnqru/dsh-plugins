/**
 * Which Remote calls a federated Session must have answered by its owner.
 *
 * The browser's Host resolves a *local* Agent before a non-`session` endpoint runs, and a federated
 * row has none, so `@` candidates, the `/` catalog, and a Session's skills list all come back
 * empty for a peer Session. Those calls carry the Session identity in the payload — as `agentId`,
 * or inside a `request` object — which is what lets one interceptor cover every such endpoint.
 *
 * The `session` namespace is deliberately excluded: the Host half already federates the Session
 * Controller, so forwarding those calls again would route the same work twice.
 *
 * Kept apart from React and the transport so the routing rule can be tested on its own.
 * @module dsh-plugin-session-manager/client/agent-call
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

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
  const args = (payload as { readonly args?: Readonly<Record<string, unknown>> } | undefined)?.args
  if (args === undefined) return undefined
  const agentId = args['agentId']
  if (typeof agentId === 'string') return agentId as SessionId
  const request = args['request'] as Readonly<Record<string, unknown>> | undefined
  if (typeof request?.['sessionId'] === 'string') return request['sessionId'] as SessionId
  const sessionId = args['sessionId']
  return typeof sessionId === 'string' ? sessionId as SessionId : undefined
}
