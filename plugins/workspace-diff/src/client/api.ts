/**
 * The browser half's data access: the two routes.
 *
 * Fetched through the same origin the page came from, so Connection's authentication fence covers
 * them and no credential handling lives here. Every call takes the caller's signal; the views poll
 * on their own timers, so this module owns no watch stream.
 * @module dsh-plugin-workspace-diff/client/api
 */

/** One row of the changes response. */
export interface ChangedFileView {
  readonly path: string
  readonly status: string
  readonly added: number | null
  readonly removed: number | null
  readonly renamedFrom?: string
}

/** The changes route's answer. */
export type ChangesOutcome =
  | { readonly ok: true; readonly repoRoot: string; readonly files: readonly ChangedFileView[] }
  | { readonly ok: false; readonly reason: string }

/** One hunk of the served comparison, as git produced it. */
export interface DiffHunkView {
  /** The `@@ -a,b +c,d @@` line, drawn as the hunk's header. */
  readonly header: string
  /** First line of the hunk on the old side. */
  readonly oldStart: number
  /** First line of the hunk on the new side. */
  readonly newStart: number
  /** The hunk's lines with their `+`/`-`/space prefixes; a `\` line is git's own note. */
  readonly lines: readonly string[]
}

/** The diff route's answer: git's own hunks, plus what the header row shows about the file. */
export type DiffOutcome =
  | {
    readonly ok: true
    readonly path: string
    readonly hunks: readonly DiffHunkView[]
    readonly added: number | null
    readonly removed: number | null
    readonly truncated: boolean
  }
  | { readonly ok: false; readonly reason: string }

/** What the view's component is handed. */
export interface WorkspaceDiffApi {
  /** Read the changed-file list. */
  loadChanges(signal: AbortSignal): Promise<ChangesOutcome>
  /** Read one accepted path's two sides. */
  loadDiff(path: string, signal: AbortSignal): Promise<DiffOutcome>
}

/**
 * Build the view's data access for one Session.
 * @param sessionId - the Session this view is rendering.
 * @returns the access object the component receives.
 */
export function createWorkspaceDiffApi(sessionId: string): WorkspaceDiffApi {
  const query = 'sessionId=' + encodeURIComponent(sessionId)
  return {
    async loadChanges(signal) {
      const response = await fetch('/api/workspace-diff.changes?' + query, {
        signal,
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error('workspace-diff.changes answered HTTP ' + response.status)
      return await response.json() as ChangesOutcome
    },
    async loadDiff(path, signal) {
      const response = await fetch('/api/workspace-diff.diff?' + query + '&path=' + encodeURIComponent(path), {
        signal,
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error('workspace-diff.diff answered HTTP ' + response.status)
      return await response.json() as DiffOutcome
    },
  }
}
