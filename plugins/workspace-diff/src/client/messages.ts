/**
 * Text derived from a route answer, shared by every surface that shows one.
 * @module dsh-plugin-workspace-diff/client/messages
 */

import type { WorkspaceDiffKey } from './locales.ts'

/**
 * @param value - a count, or null when git did not count the file.
 * @returns the text the rows show.
 */
export function countLabel(value: number | null): string {
  return value === null ? '?' : String(value)
}

/**
 * The empty-state text for one route refusal.
 * @param t - the namespace's translate function.
 * @param reason - the refusal's reason string.
 * @returns the message to show.
 */
export function reasonMessage(t: (key: WorkspaceDiffKey) => string, reason: string): string {
  switch (reason) {
    case 'not-a-repo': return t('state.notARepo')
    case 'no-git': return t('state.noGit')
    case 'no-cwd': return t('state.noCwd')
    case 'truncated': return t('state.truncated')
    case 'not-in-repo': return t('state.notInRepo')
    case 'too-large': return t('state.tooLarge')
    case 'binary': return t('state.binary')
    default: return t('state.unknown')
  }
}
