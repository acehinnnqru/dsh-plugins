/**
 * The right Sidebar address of one file's diff.
 *
 * The same shape the per-turn review uses (`dsh-resource://changes-review/session/…`): the Session
 * identifies the workspace, the repository-relative path identifies the file, and the address is
 * what makes opening the same file twice the same tab instead of two of them.
 * @module dsh-plugin-workspace-diff/client/address
 */

/** This implementation's identity in the tab system, and the key its body registers under. */
export const TAB_ID = 'dsh-plugin-workspace-diff'

/** The tab kind this plugin owns; the segment after `dsh-resource://` in its addresses. */
export const TAB_KIND = 'workspace-diff'

/** Every address this plugin mints starts here; anything else is not ours. */
const PREFIX = 'dsh-resource://' + TAB_KIND + '/session/'

/**
 * @param sessionId - the Session whose workspace holds the file.
 * @param path - the repository-relative path the status call reported.
 * @returns the address the right Sidebar opens.
 */
export function diffAddress(sessionId: string, path: string): string {
  return PREFIX + encodeURIComponent(sessionId) + '/' + encodeURIComponent(path)
}

/**
 * Read one address back.
 * @param address - a resource address.
 * @returns the Session and path, or undefined for any address this plugin did not mint.
 */
export function parseDiffAddress(address: string): { sessionId: string; path: string } | undefined {
  if (!address.startsWith(PREFIX)) return undefined
  const parts = address.slice(PREFIX.length).split('/')
  if (parts.length !== 2) return undefined
  const [session = '', path = ''] = parts
  try {
    return { sessionId: decodeURIComponent(session), path: decodeURIComponent(path) }
  } catch {
    // A malformed escape is not an address of ours.
    return undefined
  }
}

/**
 * The tab chip's text: the file's own name, since the path is what the body shows in full.
 * @param address - a resource address.
 * @returns the base name, or the address when it is not ours.
 */
export function diffTitle(address: string): string {
  const parsed = parseDiffAddress(address)
  if (parsed === undefined) return address
  const segments = parsed.path.split('/')
  return segments.at(-1) ?? parsed.path
}
