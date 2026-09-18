import { describe, expect, it } from 'vitest'
import { clockLabel, timestamp } from '../src/client/format.ts'

/**
 * The clock's text, which is the whole of what the browser half puts on screen.
 *
 * The formatter follows the browser's locale, so the assertions are built from `Intl` rather than
 * hard-coded: a test pinned to one machine's locale would fail on the next machine for no reason.
 */
describe('clock label', () => {
  /** A fixed instant: the label must depend on the date passed in, not on when the test runs. */
  const at = new Date('2026-03-04T05:06:07.000Z')

  it('shows the date and the time when the sidebar is wide', () => {
    const parts = new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).format(at).replace(',', ' ')
    expect(clockLabel(at, true)).toBe(parts)
  })

  it('shows only the time in the 56px rail', () => {
    const parts = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(at)
    expect(clockLabel(at, false)).toBe(parts)
    // The rail label is a strict prefix-length reduction of the wide one, never the same string.
    expect(clockLabel(at, false).length).toBeLessThan(clockLabel(at, true).length)
  })

  it('uses a 24-hour clock, so two readings a day never collide', () => {
    const morning = clockLabel(new Date('2026-03-04T01:00:00.000Z'), false)
    const afternoon = clockLabel(new Date('2026-03-04T13:00:00.000Z'), false)
    expect(morning).not.toBe(afternoon)
  })

  it('keeps the label free of the comma the locale formatter inserts', () => {
    expect(clockLabel(at, true)).not.toContain(',')
  })
})

describe('timestamp', () => {
  it('is the ISO-8601 UTC string the now tool returns by default', () => {
    expect(timestamp(new Date('2026-03-04T05:06:07.000Z'))).toBe('2026-03-04T05:06:07.000Z')
  })
})
