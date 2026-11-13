import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import {
  handsOffToSessionPage,
  previewDestination,
  type EmbeddedClick,
} from '../src/client/preview-links.ts'

/**
 * The preview dialog's hand-off rule.
 *
 * The shared renderer's file chips and HTTP(S) anchors open in the right Sidebar, which only the
 * real Session page mounts; every other click stays inside the embedded Conversation.
 */

const { document } = new JSDOM('<!doctype html><html><body></body></html>').window

/**
 * Build one element from markup.
 * @param html - the element's markup.
 * @returns the element.
 */
function element(html: string): Element {
  const host = document.createElement('div')
  host.innerHTML = html
  const first = host.firstElementChild
  if (first === null) throw new Error(`no element for ${html}`)
  return first
}

/**
 * One captured click aimed at a target.
 * @param target - the clicked node.
 * @param overrides - fields changed from a plain primary click.
 * @returns the click.
 */
function click(target: EventTarget | null, overrides: Partial<EmbeddedClick> = {}): EmbeddedClick {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target,
    ...overrides,
  }
}

describe('handsOffToSessionPage', () => {
  it('hands off an inline-code file path mention', () => {
    const chip = element('<button class="fileMention_1a2b_3">src/a.ts</button>')
    expect(handsOffToSessionPage(click(chip))).toBe(true)
  })

  it('hands off a Markdown file link from a node inside it', () => {
    const chip = element('<button class="fileMention_1a2b_3 fileLink_4c5d_6"><span>x</span></button>')
    expect(handsOffToSessionPage(click(chip.querySelector('span')))).toBe(true)
  })

  it('hands off HTTP and HTTPS anchors from a node inside them', () => {
    const anchor = element('<a href="https://example.com/a"><span>x</span></a>')
    expect(handsOffToSessionPage(click(anchor.querySelector('span')))).toBe(true)
    expect(handsOffToSessionPage(click(element('<a href="http://example.com">x</a>')))).toBe(true)
  })

  it('leaves other destinations and plain content inside', () => {
    expect(handsOffToSessionPage(click(element('<a href="mailto:a@example.com">x</a>')))).toBe(false)
    expect(handsOffToSessionPage(click(element('<a href="/relative">x</a>')))).toBe(false)
    expect(handsOffToSessionPage(click(element('<span>plain</span>')))).toBe(false)
    expect(handsOffToSessionPage(click(null))).toBe(false)
  })

  it('names the file a chip points at', () => {
    const chip = element('<button class="fileMention_1a2b_3" title="src/a.ts">a.ts</button>')
    expect(previewDestination(click(chip))).toEqual({ kind: 'file', path: 'src/a.ts' })
  })

  it('names a web address from an anchor', () => {
    const anchor = element('<a href="https://example.com/a"><span>x</span></a>')
    expect(previewDestination(click(anchor.querySelector('span'))))
      .toEqual({ kind: 'url', url: 'https://example.com/a' })
  })

  it('leaves a file target the chip does not name to the page', () => {
    const chip = element('<button class="fileMention_1a2b_3 fileLink_4c5d_6"><img alt=""></button>')
    expect(previewDestination(click(chip))).toBeUndefined()
  })

  it('has no destination for an ordinary click', () => {
    expect(previewDestination(click(element('<span>plain</span>')))).toBeUndefined()
  })

  it('ignores modified and non-primary clicks', () => {
    const chip = element('<button class="fileLink_4c5d_6">x</button>')
    expect(handsOffToSessionPage(click(chip, { metaKey: true }))).toBe(false)
    expect(handsOffToSessionPage(click(chip, { ctrlKey: true }))).toBe(false)
    expect(handsOffToSessionPage(click(chip, { shiftKey: true }))).toBe(false)
    expect(handsOffToSessionPage(click(chip, { altKey: true }))).toBe(false)
    expect(handsOffToSessionPage(click(chip, { button: 2 }))).toBe(false)
  })
})

/** The deliverables' changed-files card inside one turn. */
const CARD = `
  <div data-turn-tail="3">
    <div data-changed-files>
      <button class="ChangedFiles_header_1">Edited 2 files</button>
      <ul>
        <li><button class="ChangedFiles_row_2">a.ts</button></li>
        <li><button class="ChangedFiles_row_2">b.ts</button></li>
      </ul>
      <button class="ChangedFiles_toggle_3">All 5</button>
    </div>
  </div>`

describe('changed-file controls', () => {
  it('hands off the card header and names its turn', () => {
    const header = element(CARD).querySelector('button')
    expect(handsOffToSessionPage(click(header))).toBe(true)
    expect(previewDestination(click(header))).toEqual({ kind: 'changes', turn: 3, control: 0 })
  })

  it('hands off a file row with its position in the card', () => {
    const row = element(CARD).querySelectorAll('li button')[1]
    expect(handsOffToSessionPage(click(row))).toBe(true)
    expect(previewDestination(click(row))).toEqual({ kind: 'changes', turn: 3, control: 2 })
  })

  it('keeps the list expander local', () => {
    const toggle = element(CARD).querySelector('[class*="toggle"]')
    expect(handsOffToSessionPage(click(toggle))).toBe(false)
    expect(previewDestination(click(toggle))).toBeUndefined()
  })

  it('hands off a card that cannot name its turn without a destination', () => {
    const header = element('<div data-changed-files><button>Edited files</button></div>')
      .querySelector('button')
    expect(handsOffToSessionPage(click(header))).toBe(true)
    expect(previewDestination(click(header))).toBeUndefined()
  })
})
