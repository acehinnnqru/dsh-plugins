/**
 * The browser half's data access: the two routes, and the workspace file watch.
 *
 * Fetched through the same origin the page came from, so Connection's authentication fence covers
 * them and no credential handling lives here. Every call takes the caller's signal, and the watch is
 * an async stream that ends when that signal aborts.
 * @module dsh-plugin-workspace-diff/client/api
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: it carries the Context merge that puts the mounted `remote` face on `ctx`.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceFileChange } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

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
  /** Follow host-side file observations until the signal aborts. */
  watch(onChange: (change: WorkspaceFileChange) => void, signal: AbortSignal): void
}

/**
 * Build the view's data access for one Session.
 * @param ctx - client context carrying the mounted Remote namespaces.
 * @param sessionId - the Session this view is rendering.
 * @returns the access object the component receives.
 */
export function createWorkspaceDiffApi(ctx: ClientContext, sessionId: string): WorkspaceDiffApi {
  const query = 'sessionId=' + encodeURIComponent(sessionId)
  return {
    async loadChanges(signal) {
      const response = await fetch('/api/workspace-diff.changes?' + query, {
        signal,
        headers: { accept: 'application/json' },
      })
      return await response.json() as ChangesOutcome
    },
    async loadDiff(path, signal) {
      const response = await fetch('/api/workspace-diff.diff?' + query + '&path=' + encodeURIComponent(path), {
        signal,
        headers: { accept: 'application/json' },
      })
      return await response.json() as DiffOutcome
    },
    watch(onChange, signal) {
      const frames = ctx.remote.workspaceFiles.changes(sessionId as SessionId, signal)
      void (async () => {
        try {
          for await (const frame of frames) {
            // ready only confirms the Host is observing; the view refreshes on observations.
            if (frame.kind === 'change') onChange(frame.change)
          }
        } catch {
          // A closed or aborted stream is the normal end of a view's lifetime.
        }
      })()
    },
  }
}
