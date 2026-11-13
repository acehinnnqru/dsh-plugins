import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  fileAddress,
  replayChangesReview,
  whenRightColumnMounts,
} from '../src/client/right-column.ts'

/**
 * The replay of a previewed click on the real Session page.
 *
 * `fileAddress` has to name the file the product's own preview claims, the mount wait has to
 * survive the moment before that page has a right column, and the changed-files replay has to click
 * the page's own card rather than the preview copy on its way out.
 */

/** Brand a literal string as a Session id. */
function id(value: string): SessionId {
  return value as SessionId
}

describe('fileAddress', () => {
  it('keeps a workspace-relative path relative', () => {
    expect(fileAddress(id('ses_1'), 'src/a.ts')).toBe('dsh-resource://file/session/ses_1/src/a.ts')
  })

  it('keeps an absolute path absolute', () => {
    expect(fileAddress(id('ses_1'), '/work/src/a.ts'))
      .toBe('dsh-resource://file/session/ses_1//work/src/a.ts')
  })

  it('normalizes Windows separators and leading ./ segments', () => {
    expect(fileAddress(id('ses_1'), '.\\src\\a.ts'))
      .toBe('dsh-resource://file/session/ses_1/src/a.ts')
  })

  it('encodes each segment and keeps a drive colon literal', () => {
    expect(fileAddress(id('ses_1'), 'C:\\work\\a b.ts'))
      .toBe('dsh-resource://file/session/ses_1/C:/work/a%20b.ts')
  })
})

describe('whenRightColumnMounts', () => {
  afterEach(() => {
    vi.useRealTimers()
  })


  it('waits for the navigated page before opening', () => {
    vi.useFakeTimers()
    let opened = 0
    whenRightColumnMounts(() => {
      opened += 1
    })
    expect(opened).toBe(0)
    vi.runAllTimers()
    expect(opened).toBe(1)
  })

  it('retries while the column is not mounted yet', () => {
    vi.useFakeTimers()
    let attempts = 0
    whenRightColumnMounts(() => {
      attempts += 1
      if (attempts < 3) throw new Error('sidebarRight: no session surface is mounted')
    })
    vi.runAllTimers()
    expect(attempts).toBe(3)
  })

  it('gives up instead of retrying forever', () => {
    vi.useFakeTimers()
    let attempts = 0
    whenRightColumnMounts(() => {
      attempts += 1
      throw new Error('sidebarRight: no session surface is mounted')
    })
    vi.runAllTimers()
    const settled = attempts
    expect(settled).toBeGreaterThan(1)
    vi.runAllTimers()
    expect(attempts).toBe(settled)
  })
})

describe('replayChangesReview', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /**
   * Install one document for the replay to search.
   * @param html - the page body.
   * @returns the installed document.
   */
  function page(html: string): Document {
    const { document } = new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
    vi.stubGlobal('document', document)
    return document
  }

  /**
   * Record the clicks landing on the named elements.
   * @param document - the page under test.
   * @param ids - ids of the elements to watch.
   * @returns the list clicks are appended to.
   */
  function record(document: Document, ids: readonly string[]): string[] {
    const clicked: string[] = []
    for (const id of ids) {
      document.getElementById(id)?.addEventListener('click', () => clicked.push(id))
    }
    return clicked
  }

  it('clicks the same control on the page card', () => {
    vi.useFakeTimers()
    const document = page(`<div data-turn-tail="3"><div data-changed-files>
      <button id="header"></button>
      <ul><li><button id="row"></button></li></ul>
    </div></div>`)
    const clicked = record(document, ['header', 'row'])

    replayChangesReview(3, 1)
    vi.runAllTimers()

    expect(clicked).toEqual(['row'])
  })

  it('ignores the card of the preview that is closing', () => {
    vi.useFakeTimers()
    const document = page(`
      <div role="dialog"><div data-turn-tail="3"><div data-changed-files>
        <button id="preview"></button>
      </div></div></div>
      <div data-turn-tail="3"><div data-changed-files>
        <button id="page"></button>
      </div></div>`)
    const clicked = record(document, ['preview', 'page'])

    replayChangesReview(3, 0)
    vi.runAllTimers()

    expect(clicked).toEqual(['page'])
  })

  it('stops when the page never draws the card', () => {
    vi.useFakeTimers()
    page('')

    replayChangesReview(9, 0)
    vi.runAllTimers()

    expect(vi.getTimerCount()).toBe(0)
  })
})
