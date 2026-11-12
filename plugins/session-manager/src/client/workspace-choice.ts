/**
 * The bridge between the new-conversation overlay and the Workspace picker rendered inside the
 * native hero.
 *
 * The picker is a slot entry owned by this plugin, not by the page: the Conversation Factory renders
 * it, so it cannot receive the page's callbacks through props. The page publishes one chooser while
 * the overlay is open; the picker renders nothing whenever that chooser is absent, which keeps it out
 * of the main new-session page.
 * @module dsh-plugin-session-manager/client/workspace-choice
 */

import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Move the open new conversation to another Workspace.
 * @param sessionId - the blank Session the overlay is showing.
 * @param workspaceId - the chosen Workspace.
 * @returns a localized failure, or undefined after the overlay moved.
 */
export type ChooseWorkspace = (
  sessionId: SessionId,
  workspaceId: WorkspaceId,
) => Promise<string | undefined>

/** The chooser published by the open overlay, or undefined outside it. */
let choose: ChooseWorkspace | undefined

/** Mounted picker subscriptions. */
const listeners = new Set<() => void>()

/** Notify every mounted picker that the chooser changed. */
function publish(): void {
  for (const listener of listeners) listener()
}

/**
 * Read the chooser the open overlay published.
 * @returns the chooser, or undefined when no overlay is open.
 */
export function activeChooseWorkspace(): ChooseWorkspace | undefined {
  return choose
}

/**
 * Publish or clear the overlay's chooser.
 * @param next - the chooser while the overlay is open, undefined when it closes.
 */
export function setChooseWorkspace(next: ChooseWorkspace | undefined): void {
  choose = next
  publish()
}

/**
 * Observe chooser changes.
 * @param listener - called after the chooser is published or cleared.
 * @returns unsubscribe.
 */
export function subscribeChooseWorkspace(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
