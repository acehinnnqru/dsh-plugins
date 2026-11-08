# dsh-plugin-workspace-diff

A Conversation view, beside Chat and Trajectory, showing the Session workspace's uncommitted git
changes: the changed-file list, and for the selected file git's own unified diff, fully expanded.

## What it does

- **Host half** — reads the Session's workspace through the profile's own shell executor and answers
  two authenticated routes below /api: /api/workspace-diff.changes?sessionId=<id> (the file list with
  +A -R) and /api/workspace-diff.diff?sessionId=<id>&path=<repo-relative path> (one file's diff as
  git's own hunks, with the file-header lines dropped). Every git call runs with workdir set to the
  repository root, with core.quotepath=false, --no-ext-diff --no-textconv, and GIT_OPTIONAL_LOCKS=0.
- **Browser half** — two surfaces over the same data. A conversation.view entry (id workspace-diff,
  order 20, so it sits after Chat and Trajectory) draws the changed files as a tree, with
  single-child directory chains compacted into one row. Picking a file opens its diff in the right
  Sidebar, in this plugin's own tab type (dsh-resource://workspace-diff/session/...), so the
  container owns the chip, title, closing, dragging and persistence; its header carries the path, the
  file's `+A -R`, and a wrap toggle that starts on. Both surfaces show the empty
  states (not a repository, no changes, no commits yet, truncated, binary, unreadable); both
  surfaces poll their route every two seconds while mounted, and the tree also has a Refresh button.

Read-only: no stage, unstage, commit, checkout, or any other mutating git command.

## Install into a profile

```sh
dsh plugin --profile <profile> add ./plugins/workspace-diff
```

The plugin only exists in a profile after that install. A rebuilt host half is picked up when the
Host restarts; the browser bundle also reloads through the Host's HMR watcher. A manifest or patch
change needs another install.

## Configuration and safety

| Option | Default | Meaning |
|---|---|---|
| — | — | The host half reads no configuration; its caps are constants in `src/git.ts`. |

What it reads: the Session's cwd and the git working tree below the repository root. What it
writes: nothing. Network: nothing beyond the two same-origin routes the browser half calls.

## Layout

| Path | Role |
|---|---|
| `src/index.ts` | Loader metadata and the route registration |
| `src/git.ts` | Command builders and the porcelain/numstat parsers (pure, unit tested) |
| `src/routes.ts` | The two routes: Session resolution, git runs, refusals |
| `src/client/index.tsx` | The `conversation.view` and tab-type registrations |
| `src/client/api.ts` | The two routes, bound to one Session |
| `src/client/hunk-rows.ts` | Hunk lines to numbered rows (pure, unit tested) |
| `src/client/WorkspaceDiffView.tsx`, `FileTree.tsx`, `DiffTab.tsx`, `DiffHunks.tsx` | The view, its tree, and the diff pane |
| `src/client/locales.ts` | `zh`/`en` copy for the `workspaceDiff` namespace |
