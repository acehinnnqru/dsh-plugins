/**
 * The bridge between the new-conversation overlay and its node picker.
 *
 * The picker is a slot entry, so it cannot receive the page's callback through props.
 * The page publishes one chooser while the overlay is open; outside it the picker
 * renders nothing.
 * @module dsh-plugin-session-manager/client/node-choice
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionNode } from './board.ts'

/** Move the open new conversation to another node. */
export type ChooseNode = (sessionId: SessionId, node: SessionNode) => Promise<string | undefined>

/** Warm one node while the menu previews it. */
export type PrepareNode = (node: SessionNode) => void

let choose: ChooseNode | undefined
let prepare: PrepareNode | undefined
const listeners = new Set<() => void>()

/** Publish or clear the overlay's node chooser. */
export function setChooseNode(next: ChooseNode | undefined): void {
  choose = next
  for (const listener of listeners) listener()
}

/** Publish or clear the warm-up callback. */
export function setPrepareNode(next: PrepareNode | undefined): void {
  prepare = next
  for (const listener of listeners) listener()
}

/** Read the current warm-up callback. */
export function activePrepareNode(): PrepareNode | undefined {
  return prepare
}

/** Observe both chooser callbacks. */
export function subscribeNodeChoice(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Observe the warm-up callback. */
export function subscribePrepareNode(listener: () => void): () => void {
  return subscribeNodeChoice(listener)
}

/** Read the current chooser. */
export function activeChooseNode(): ChooseNode | undefined {
  return choose
}

/** Observe chooser changes. */
export function subscribeChooseNode(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
