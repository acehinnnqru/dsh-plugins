import { describe, expect, it } from 'vitest'
import { federatedByHost, payloadSession } from '../src/client/agent-call.ts'

/**
 * The routing rule for a Remote call that names a Session.
 *
 * The browser routes these to the owning node; the rule decides which calls those are, and which
 * ones the Host half already federates and must therefore stay local.
 */
describe('payloadSession', () => {
  it('reads the Agent identity of an Agent-scoped endpoint', () => {
    expect(payloadSession('fileReferences/list', { args: { agentId: '01S', query: 'src' } })).toBe('01S')
    expect(payloadSession('commands/list', { args: { agentId: '01S' } })).toBe('01S')
    expect(payloadSession('commands/execute', { args: { agentId: '01S', line: '/goal' } })).toBe('01S')
  })

  it('reads a Session identity nested in a request object', () => {
    // The skills catalog names its Session inside the request value, not as a wire argument.
    expect(payloadSession('skills/list', { args: { request: { sessionId: '01S' } } })).toBe('01S')
  })

  it('reads a bare Session identity outside the request object', () => {
    expect(payloadSession('some/endpoint', { args: { sessionId: '01S' } })).toBe('01S')
  })

  it('leaves the whole session namespace to the Host', () => {
    expect(federatedByHost('session/prompt')).toBe(true)
    expect(federatedByHost('session')).toBe(true)
    expect(federatedByHost('commands/list')).toBe(false)
    // `sessions` is not the controller namespace and must not match by prefix accident.
    expect(federatedByHost('sessions/list')).toBe(false)
    expect(payloadSession('session/state', { args: { sessionId: '01S' } })).toBeUndefined()
    expect(payloadSession('session/attachment', { args: { sessionId: '01S' } })).toBeUndefined()
  })

  it('returns nothing when the payload names no Session', () => {
    expect(payloadSession('commands/list', undefined)).toBeUndefined()
    expect(payloadSession('commands/list', {})).toBeUndefined()
    expect(payloadSession('commands/list', { args: {} })).toBeUndefined()
    expect(payloadSession('commands/list', { args: { agentId: 7 } })).toBeUndefined()
    expect(payloadSession('skills/list', { args: { request: { sessionId: 7 } } })).toBeUndefined()
  })
})
