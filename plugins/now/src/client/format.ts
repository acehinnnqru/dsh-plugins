/**
 * The clock's formatting, split out from the component so it can be tested without a DOM or React.
 *
 * Everything here is pure and depends on nothing but the `Date` it is handed, which is also what
 * makes the browser half's visible output assertable in Node.
 *
 * @module dsh-plugin-now/client/format
 */

/** Separator between the date and the time in {@link clockLabel}. */
const DATE_TIME_SEPARATOR = ' '

/** One formatter per width: constructing `Intl.DateTimeFormat` is the expensive part of a tick. */
const WIDE = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** The rail is 56px wide and shows only the mark, so a wall clock cannot fit beside it. */
const NARROW = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/**
 * The text the clock shows for one instant.
 *
 * The locale is the browser's own, so the same instant reads differently in two deployments; that is
 * the point — this is the viewer's clock, not the host's, and the `now` tool's configured `timeZone`
 * does not apply to it.
 *
 * @param at - the instant to render.
 * @param wide - whether the sidebar renders wide content; false is the 56px rail.
 * @returns the localized date and time when wide, the time alone when narrow.
 */
export function clockLabel(at: Date, wide: boolean): string {
  const formatted = (wide ? WIDE : NARROW).format(at)
  return wide ? formatted.replace(',', DATE_TIME_SEPARATOR) : formatted
}

/**
 * The exact timestamp the clock offers to the clipboard.
 *
 * ISO-8601 UTC is the same string the `now` tool returns for its default format, and unlike the
 * rendered label it is unambiguous about the zone it is in.
 *
 * @param at - the instant to render.
 * @returns the ISO-8601 UTC timestamp.
 */
export function timestamp(at: Date): string {
  return at.toISOString()
}
