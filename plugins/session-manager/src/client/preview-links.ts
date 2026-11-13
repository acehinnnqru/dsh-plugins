/**
 * What a click inside an embedded Conversation asks for, and when the real Session page must take it.
 *
 * The product opens a file reference, an external page, and a turn's change review in the right
 * Sidebar, and that column is mounted only while the Conversation fills the main column. The
 * board's preview dialog and its expanded page embed the Conversation in a global panel, so the
 * product's own handler cannot succeed there: a file chip raises the native "couldn't open file"
 * dialog, and a web link or the changed-files card does nothing at all. Both surfaces therefore
 * hand such a click to the real Session page, which owns the column, and carry the destination with
 * it so the page can open it in the same click.
 *
 * The file chips are the shared Markdown renderer's: an inline-code path mention carries the
 * `fileMention` class and a link to a file carries `fileLink` (both behind a CSS-module hash, hence
 * the substring match). External links are ordinary anchors to an HTTP(S) address. The changed-files
 * card is the deliverables tail's: its header and rows name the turn through the tail they sit in,
 * and its list expander stays local to the surface.
 * @module dsh-plugin-session-manager/client/preview-links
 */

/** A destination the embedded Conversation cannot open where it is drawn. */
export type PreviewDestination =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string }
  /**
   * A turn's change review. `control` is the clicked button's index in the card, which is how the
   * review re-opens there: only the card's own handler holds the turn's coordinates.
   */
  | { readonly kind: 'changes'; readonly turn: number; readonly control: number }

/** The click fields the decision reads; a React synthetic event satisfies this shape. */
export interface EmbeddedClick {
  readonly button: number
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly target: EventTarget | null
}

/**
 * Read the clicked node's closest ancestor matching a selector.
 *
 * Duck-typed so the decision survives a non-browser test environment; a real click always lands on
 * an Element.
 * @param target - the clicked node.
 * @param selector - the ancestor selector.
 * @returns the matching ancestor, or undefined.
 */
function ancestor(target: EventTarget | null, selector: string): Element | undefined {
  if (target === null || typeof (target as Element).closest !== 'function') return undefined
  return (target as Element).closest(selector) ?? undefined
}

/**
 * The file chip a click landed in.
 * @param target - the clicked node.
 * @returns the chip, or undefined when the click is not on one.
 */
function fileChip(target: EventTarget | null): Element | undefined {
  return ancestor(target, 'button[class*="fileMention"], button[class*="fileLink"]')
}

/**
 * The HTTP(S) anchor a click landed in.
 * @param target - the clicked node.
 * @returns the anchor, or undefined for anything else.
 */
function externalAnchor(target: EventTarget | null): Element | undefined {
  const anchor = ancestor(target, 'a[href]')
  if (anchor === undefined) return undefined
  try {
    const { protocol } = new URL(anchor.getAttribute('href') ?? '')
    return protocol === 'http:' || protocol === 'https:' ? anchor : undefined
  } catch {
    return undefined
  }
}

/**
 * The changed-files card control a click landed on.
 *
 * Only the card's header and its file rows leave for the page. The list expander only changes how
 * many rows are drawn, so it stays local: a click on it is not a change review.
 * @param target - the clicked node.
 * @returns the card and the clicked button's index in it, or undefined.
 */
function changedFileControl(
  target: EventTarget | null,
): { readonly card: Element; readonly control: number } | undefined {
  const card = ancestor(target, '[data-changed-files]')
  if (card === undefined) return undefined
  const button = ancestor(target, 'button')
  if (button === undefined || !card.contains(button)) return undefined
  const control = [...card.querySelectorAll('button')].findIndex((candidate) => candidate === button)
  if (control < 0) return undefined
  // A button outside the file list is the expander unless it is the card's own header.
  if (button.closest('li') === null && control !== 0) return undefined
  return { card, control }
}

/**
 * The turn whose tail holds a changed-files card.
 * @param card - the card element.
 * @returns the turn number, or undefined outside a turn tail.
 */
function cardTurn(card: Element): number | undefined {
  const turn = Number(card.closest('[data-turn-tail]')?.getAttribute('data-turn-tail') ?? '')
  return Number.isSafeInteger(turn) && turn >= 1 ? turn : undefined
}

/**
 * Whether a click asks for a destination this surface cannot open.
 *
 * Modified clicks keep the browser's own behavior, matching the shared link handler.
 * @param event - the click captured on the embedded body.
 * @returns true when the real Session page should take the click instead.
 */
export function handsOffToSessionPage(event: EmbeddedClick): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false
  }
  return fileChip(event.target) !== undefined
    || externalAnchor(event.target) !== undefined
    || changedFileControl(event.target) !== undefined
}

/**
 * The destination a clicked file chip, web link, or changed-files control names.
 *
 * A file chip whose text is the only description of its target — an image link, which the renderer
 * draws without a title — and a changed-files card outside a turn tail yield nothing: the click
 * still leaves for the real page, which is where the product's own handler can serve it.
 * @param event - the click captured on the embedded body.
 * @returns the destination, or undefined when the click does not name one.
 */
export function previewDestination(event: EmbeddedClick): PreviewDestination | undefined {
  const chip = fileChip(event.target)
  if (chip !== undefined) {
    const path = chip.getAttribute('title')?.trim() ?? ''
    return path === '' ? undefined : { kind: 'file', path }
  }
  const changed = changedFileControl(event.target)
  if (changed !== undefined) {
    const turn = cardTurn(changed.card)
    return turn === undefined ? undefined : { kind: 'changes', turn, control: changed.control }
  }
  const href = externalAnchor(event.target)?.getAttribute('href') ?? ''
  return href === '' ? undefined : { kind: 'url', url: href }
}
