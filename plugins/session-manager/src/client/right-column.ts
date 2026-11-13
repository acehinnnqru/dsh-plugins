/**
 * Opening a previewed destination in the real Session page's right column.
 *
 * The product mounts the right Sidebar only while the Conversation fills the main column, so an
 * embedded Conversation cannot serve a file reference, a web link, or a turn's change review. The
 * click that asks for one navigates to the real Session page first; this module then opens the
 * destination on that page — through the column's own command for a file or a web link, and through
 * the changed-files card's own handler for a review, which alone holds the turn's coordinates.
 * @module dsh-plugin-session-manager/client/right-column
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The right column's navigation face, reached through `ctx.get` so a build without it still works. */
export interface RightColumn {
  /**
   * Open a resource address in the column.
   * @param address - a `dsh-resource://` address.
   * @param options - navigation parameters for the opening type.
   */
  openResource(address: string, options?: { readonly params?: { readonly line?: number } }): void
  /**
   * Open a page type by kind in the column.
   * @param kind - the registered page kind.
   * @param options - navigation parameters for that kind.
   */
  openTab(kind: string, options?: { readonly params?: { readonly url: string } }): void
}

/** How long one attempt waits for the freshly navigated page to mount its column. */
const MOUNT_RETRY_MS = 16

/** How many attempts that wait allows before the destination is dropped. */
const MOUNT_ATTEMPTS = 20

/** How long one attempt waits for the real page to draw the control a review opens from. */
const PAGE_RETRY_MS = 16

/** How many attempts that wait allows before the replay is dropped. */
const PAGE_ATTEMPTS = 60

/**
 * Component-encode one address segment, keeping `:` literal for Windows drive letters.
 * @param segment - one path or id component.
 * @returns the encoded segment.
 */
function encodeValue(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':')
}

/**
 * The `dsh-resource://file/…` address of a path read through one Session.
 *
 * This is the product's own file-address grammar: an absolute path stays absolute in that Session's
 * address, and a relative one resolves against the Session's workspace.
 * @param sessionId - the Session the path is read in.
 * @param path - absolute or workspace-relative path, in either separator spelling.
 * @returns the address the file preview claims.
 */
export function fileAddress(sessionId: SessionId, path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  const encoded = normalized.split('/').map(encodeValue).join('/')
  return `dsh-resource://file/session/${encodeValue(sessionId)}/${encoded}`
}

/**
 * Run one right-column command once the navigated-to page has mounted its column.
 *
 * Every command throws while no Session surface is mounted, and the page mints its store in the
 * commit the navigation causes, so retry on a timer instead of guessing a delay. A command that
 * still fails after the budget is dropped: the user is on the page and can repeat the click there.
 * @param open - the right-column command.
 */
export function whenRightColumnMounts(open: () => void): void {
  let left = MOUNT_ATTEMPTS
  const attempt = (): void => {
    try {
      open()
    } catch {
      left -= 1
      if (left > 0) setTimeout(attempt, MOUNT_RETRY_MS)
    }
  }
  setTimeout(attempt, MOUNT_RETRY_MS)
}

/**
 * Find the real page's changed-files card controls for one turn.
 *
 * A card inside a dialog is the preview's own copy on its way out; the page's copy is the one
 * outside every dialog.
 * @param turn - the turn whose card to find.
 * @returns the card's buttons in render order, or undefined while the page has not drawn it.
 */
function pageCardButtons(turn: number): HTMLButtonElement[] | undefined {
  for (const card of document.querySelectorAll(`[data-turn-tail="${turn}"] [data-changed-files]`)) {
    if (card.closest('[role="dialog"]') === null) return [...card.querySelectorAll('button')]
  }
  return undefined
}

/**
 * Replay a changed-files click on the real Session page.
 *
 * A review opens through the card's own handler, which alone holds the turn's coordinates, so the
 * faithful replay is that handler: find the turn's card on the page that just opened and click the
 * control the user clicked. The newest turns render immediately; a card the transcript has
 * virtualized out is left unserved, and the click has still moved to the page.
 * @param turn - the turn whose card was clicked.
 * @param control - the clicked button's index in the card.
 */
export function replayChangesReview(turn: number, control: number): void {
  let left = PAGE_ATTEMPTS
  const attempt = (): void => {
    const button = pageCardButtons(turn)?.[control]
    if (button !== undefined) {
      button.click()
      return
    }
    left -= 1
    if (left > 0) setTimeout(attempt, PAGE_RETRY_MS)
  }
  setTimeout(attempt, PAGE_RETRY_MS)
}
