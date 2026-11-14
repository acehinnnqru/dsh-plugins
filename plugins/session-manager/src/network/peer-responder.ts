/**
 * Serve this host's Sessions to peer requests arriving through the server
 * bridge. The server has already authenticated the sender and confined it to
 * the same group, so this layer only maps operations onto the local Session
 * Controller.
 * @module dsh-plugin-session-manager/network/peer-responder
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  BridgeEndFrame,
  BridgeErrorFrame,
  BridgeRequestFrame,
  BridgeResponseFrame,
  BridgeStreamFrame,
} from './protocol.ts'
import type { IncomingBridgeRequest } from './node.ts'
import { localMethods } from './federation.ts'

/** Structural controller methods the responder may call. */
type Controller = Record<string, (...args: any[]) => any>

/** One outgoing bridge answer, before the sender id is attached. */
type Answer = BridgeResponseFrame | BridgeStreamFrame | BridgeEndFrame | BridgeErrorFrame

/** Body of one answer; the responder adds v, id, and to. */
type AnswerBody =
  | { readonly type: 'bridge.response'; readonly ok: boolean; readonly value?: unknown; readonly error?: { readonly code: string; readonly message: string } }
  | { readonly type: 'bridge.stream'; readonly frame: unknown }
  | { readonly type: 'bridge.end' }
  | { readonly type: 'bridge.error'; readonly error: { readonly code: string; readonly message: string } }

/** Responder options. */
export interface PeerResponderOptions {
  readonly controller: object
  readonly logger: (message: string) => void
  readonly sender: (frame: BridgeResponseFrame | BridgeStreamFrame | BridgeEndFrame | BridgeErrorFrame) => void
}

/** One live responder. */
export interface PeerResponder {
  handle(frame: IncomingBridgeRequest): void
  cancel(id: string): void
  close(): void
}

/** Invoke one controller method, preferring the local pre-federation methods. */
function invoke(controller: Controller, name: string, ...args: unknown[]): any {
  const locals = localMethods(controller)
  const method = (locals ?? controller)[name]
  if (typeof method !== 'function') throw new Error('peer op unavailable: ' + name)
  return locals === undefined ? method.apply(controller, args) : method(...args)
}

/** Create one responder over a Session Controller. */
export function createPeerResponder(options: PeerResponderOptions): PeerResponder {
  const controller = options.controller as Controller
  const streams = new Map<string, AbortController>()

  const send = (request: BridgeRequestFrame, body: AnswerBody): void => {
    options.sender({ ...body, v: 1, id: request.id, to: request.from ?? '' } as Answer)
  }

  const respond = (request: BridgeRequestFrame, value: unknown): void => {
    send(request, { type: 'bridge.response', ok: true, value })
  }

  const fail = (request: BridgeRequestFrame, error: unknown): void => {
    const message = error instanceof Error ? error.message : 'Peer operation failed.'
    options.logger('session-manager: peer op ' + request.op + ' failed: ' + message)
    const abort = streams.get(request.id)
    if (abort !== undefined) {
      streams.delete(request.id)
      send(request, { type: 'bridge.error', error: { code: 'peer/failed', message } })
      return
    }
    send(request, { type: 'bridge.response', ok: false, error: { code: 'peer/failed', message } })
  }

  const dispatch = async (request: BridgeRequestFrame): Promise<void> => {
    const args = (request.args ?? {}) as Record<string, unknown>
    const sessionId = args['sessionId'] as SessionId | undefined
    switch (request.op) {
      case 'session.list': {
        respond(request, await invoke(controller, 'list', {}, new AbortController().signal))
        return
      }
      case 'session.follow': {
        const abort = new AbortController()
        streams.set(request.id, abort)
        const follow = {
          address: { kind: 'session', sessionId },
          ...(args['maxMessages'] === undefined ? {} : { maxMessages: args['maxMessages'] }),
          ...(args['activate'] === true ? { activate: true } : {}),
          ...(args['assistantStream'] === true ? { assistantStream: true } : {}),
        }
        for await (const value of invoke(controller, 'follow', follow, abort.signal) as AsyncIterable<unknown>) {
          send(request, { type: 'bridge.stream', frame: value })
        }
        streams.delete(request.id)
        send(request, { type: 'bridge.end' })
        return
      }
      case 'session.control': {
        const abort = new AbortController()
        streams.set(request.id, abort)
        for await (const value of invoke(controller, 'control', abort.signal) as AsyncIterable<unknown>) {
          send(request, { type: 'bridge.stream', frame: value })
        }
        streams.delete(request.id)
        send(request, { type: 'bridge.end' })
        return
      }
      case 'session.events':
      case 'session.page': {
        const value = await invoke(
          controller,
          request.op === 'session.page' ? 'page' : 'events',
          { address: { kind: 'session', sessionId }, ...args },
          new AbortController().signal,
        )
        respond(request, value)
        return
      }
      case 'session.observeEvent': {
        const abort = new AbortController()
        streams.set(request.id, abort)
        for await (const value of invoke(controller, 'observeEvent', { address: { kind: 'session', sessionId } }, abort.signal) as AsyncIterable<unknown>) {
          send(request, { type: 'bridge.stream', frame: value })
        }
        streams.delete(request.id)
        send(request, { type: 'bridge.end' })
        return
      }
      case 'session.state': {
        respond(request, await invoke(controller, 'state', { sessionId }, new AbortController().signal))
        return
      }
      case 'session.projections': {
        respond(request, await invoke(controller, 'projections', { sessionId }, new AbortController().signal))
        return
      }
      case 'session.prompt': {
        respond(request, await invoke(controller, 'prompt', {
          sessionId,
          requestId: args['requestId'],
          mode: args['mode'],
          content: args['content'],
        }, new AbortController().signal))
        return
      }
      case 'session.cancel': {
        respond(request, await invoke(controller, 'cancel', { sessionId }))
        return
      }
      case 'session.rename': {
        respond(request, await invoke(controller, 'rename', { sessionId, title: args['title'] }))
        return
      }
      case 'session.attachment': {
        respond(request, await invoke(controller, 'attachment', { sessionId, attachment: args['attachment'] }))
        return
      }
      case 'session.selectModel': {
        respond(request, await invoke(controller, 'selectModel', { ...args, sessionId }))
        return
      }
      case 'session.updateQueue': {
        respond(request, await invoke(controller, 'updateQueue', { ...args, sessionId }))
        return
      }
      case 'session.openWorkspacePath': {
        respond(request, await invoke(controller, 'openWorkspacePath', { ...args, sessionId }, new AbortController().signal))
        return
      }
      case 'session.observeState': {
        const abort = new AbortController()
        streams.set(request.id, abort)
        for await (const value of invoke(controller, 'observeState', { sessionId }, abort.signal) as AsyncIterable<unknown>) {
          send(request, { type: 'bridge.stream', frame: value })
        }
        streams.delete(request.id)
        send(request, { type: 'bridge.end' })
        return
      }
      case 'session.observeProjections': {
        const abort = new AbortController()
        streams.set(request.id, abort)
        for await (const value of invoke(controller, 'observeProjections', { sessionId }, abort.signal) as AsyncIterable<unknown>) {
          send(request, { type: 'bridge.stream', frame: value })
        }
        streams.delete(request.id)
        send(request, { type: 'bridge.end' })
        return
      }
      default:
        send(request, { type: 'bridge.response', ok: false, error: { code: 'peer/unsupported', message: 'Unsupported operation.' } })
    }
  }

  return {
    handle(frame: IncomingBridgeRequest): void {
      void dispatch(frame).catch((error: unknown) => {
        fail(frame, error)
      })
    },
    cancel(id: string): void {
      streams.get(id)?.abort(new Error('peer cancelled'))
      streams.delete(id)
    },
    close(): void {
      for (const stream of streams.values()) stream.abort(new Error('peer closed'))
      streams.clear()
    },
  }
}
