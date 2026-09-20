/**
 * Reading a workspace's uncommitted changes with git.
 *
 * Everything here is pure: the builders return command text and the parsers turn command output into
 * values, so the tests can cover the formats only an odd repository produces without needing one.
 * `routes.ts` owns running the commands and shaping the HTTP answers.
 *
 * Two rules run through every command: `-c core.quotepath=false` wherever a path is printed (git
 * otherwise octal-escapes non-ASCII paths and the rows stop joining), and `--no-ext-diff
 * --no-textconv` wherever a diff is printed (repository config would otherwise replace git's own
 * hunks, which are what the browser numbers and draws).
 * @module dsh-plugin-workspace-diff/git
 */

/** The changes route, absolute below `/api` the way `ctx.connection.fetch.register` wants it. */
export const CHANGES_PATH = '/api/workspace-diff.changes'
/** The single-file diff route. */
export const DIFF_PATH = '/api/workspace-diff.diff'

/** Untracked files counted per request: each one costs a git call, so the rest show `?`. */
export const UNTRACKED_COUNT_LIMIT = 32

/** Cap on one status call: a bigger list answers `truncated` instead of a half-parsed one. */
export const STATUS_MAX_BYTES = 1 << 20
/** Cap on one collected diff; beyond it the answer carries `truncated` and the browser says so. */
export const DIFF_MAX_BYTES = 1 << 21
/** A file above this is refused before any diff command runs. */
export const FILE_MAX_BYTES = 1 << 20
/** Timeout for one git call — reading a working tree is local and small. */
export const GIT_TIMEOUT_MS = 10_000

/** The status letter the list shows. `?` is an untracked file, `U` an unmerged one. */
export type ChangeStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?'

/** One record of `git status --porcelain=v2 -z`, with a rename's second path resolved. */
export interface ChangedPath {
  /** Path relative to the repository root, exactly as porcelain prints it. */
  readonly path: string
  /** The change kind, collapsed from the two-letter XY field. */
  readonly status: ChangeStatus
  /** The pre-rename path of a rename or copy record; absent for every other status. */
  readonly renamedFrom?: string
}

/** `+A -R` for one path. `null` means "not counted": an untracked file, or a binary one. */
export interface DiffCounts {
  readonly added: number | null
  readonly removed: number | null
}

/** One row of the changes response's file list. */
export interface ChangedFile extends ChangedPath, DiffCounts {}

/** What one status parse produced. */
export interface StatusParse {
  readonly files: readonly ChangedPath[]
  /** Whether the truncated first record had to be dropped (see {@link parsePorcelainV2}). */
  readonly droppedPartial: boolean
}

const STATUS_LETTERS = new Set(['M', 'A', 'D', 'R', 'C', 'T', 'U'])

/**
 * Quote one argument for the shell the executor starts.
 * @param value - the raw argument.
 * @returns the argument wrapped so the shell reproduces it byte for byte.
 */
export function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * @returns the command that names the repository root, or fails outside a repository.
 */
export function rootCommand(): string {
  return 'git rev-parse --show-toplevel'
}

/**
 * @returns the command that detects an unborn HEAD: it exits 128 there, which is the signal.
 */
export function headCommand(): string {
  return 'git rev-parse --verify HEAD'
}

/**
 * @returns the changed-file list, NUL-separated and repo-root-relative.
 */
export function statusCommand(): string {
  return 'git -c core.quotepath=false status --porcelain=v2 -z --untracked-files=all'
}

/**
 * @param unborn - whether HEAD exists; an unborn HEAD is compared against the index instead.
 * @returns the per-file `+A -R`, once for the whole request.
 */
export function numstatCommand(unborn: boolean): string {
  return `git -c core.quotepath=false diff --numstat ${unborn ? '--cached' : 'HEAD'}`
}

/**
 * @param path - a repository-relative path the status call already reported.
 * @param unborn - whether HEAD exists; unborn repositories diff the index against the empty tree.
 * @returns the unified diff of one tracked file, staged and unstaged together.
 */
export function trackedDiffCommand(path: string, unborn: boolean): string {
  return 'git -c core.quotepath=false diff --no-color --no-ext-diff --no-textconv -U3 '
    + `${unborn ? '--cached' : 'HEAD'} -- ${quoteShellArg(path)}`
}

/**
 * @param path - a repository-relative path the status call already reported as untracked.
 * @returns the unified diff of an untracked file, taken against `/dev/null` (exit 1 when it differs).
 */
export function untrackedDiffCommand(path: string): string {
  return 'git -c core.quotepath=false diff --no-index --no-color --no-ext-diff --no-textconv -U3 /dev/null '
    + quoteShellArg(path)
}

/**
 * @param path - a repository-relative path.
 * @returns the command that prints the file's size in bytes, and nothing else.
 */
export function sizeCommand(path: string): string {
  return `wc -c < ${quoteShellArg(path)}`
}

/**
 * Count untracked files, which have no row against HEAD because HEAD does not know them.
 *
 * Each file is counted against the empty tree, so git itself decides what a line is and marks a
 * binary file `-`/`-` the way every other numstat row does. The commands are joined into one shell
 * invocation and the (always nonzero) exit code is ignored: the rows on stdout are the answer.
 * @param paths - repository-relative paths the status call reported as untracked.
 * @returns the command, or undefined when there is nothing to count.
 */
export function untrackedNumstatCommand(paths: readonly string[]): string | undefined {
  const counted = paths.slice(0, UNTRACKED_COUNT_LIMIT)
  if (counted.length === 0) return undefined
  return counted
    .map((path) => `git -c core.quotepath=false diff --no-index --numstat /dev/null -- ${quoteShellArg(path)}`)
    .join('; ')
}

/**
 * Collapse porcelain's XY field to the one letter the list shows.
 * @param xy - the two-letter index/worktree field.
 * @returns the letter, defaulting to `M` for a field this build does not know.
 */
function letterOf(xy: string): ChangeStatus {
  const [x = '.', y = '.'] = xy
  if (x === 'U' || y === 'U') return 'U'
  if (x === 'R') return 'R'
  if (x === 'C') return 'C'
  if (x !== '.' && x !== ' ') return STATUS_LETTERS.has(x) ? (x as ChangeStatus) : 'M'
  if (y !== '.' && y !== ' ') return STATUS_LETTERS.has(y) ? (y as ChangeStatus) : 'M'
  return 'M'
}

/**
 * Split one porcelain record into its fixed-width head and its path.
 *
 * The path is everything after the head because a path may contain spaces; a regex over the whole
 * record would have to guess where the head ends.
 * @param field - one NUL-separated field.
 * @param head - how many space-separated tokens precede the path.
 * @returns the head tokens and the path, or undefined for a malformed record.
 */
function splitRecord(field: string, head: number): { tokens: string[]; path: string } | undefined {
  const parts = field.split(' ')
  if (parts.length <= head) return undefined
  return { tokens: parts.slice(0, head), path: parts.slice(head).join(' ') }
}

/**
 * Parse `git status --porcelain=v2 -z`.
 *
 * A rename or copy record carries **two** paths as two NUL-separated fields — new path first, then
 * the original. Treating every field as a record would invent a phantom entry for the old path,
 * which is why this consumes the pair explicitly.
 *
 * Output that arrived truncated is the TAIL of the stream, so its first record is incomplete:
 * dropping that one field is what makes the rest parsable.
 * @param output - the command's stdout, NUL-separated, without a trailing empty field.
 * @param truncated - whether bytes were dropped from the front of `output`.
 * @returns the changed paths and whether a partial record was dropped.
 */
export function parsePorcelainV2(output: string, truncated: boolean): StatusParse {
  const fields = output.split('\0')
  if (fields.at(-1) === '') fields.pop()

  let droppedPartial = false
  if (truncated && fields.length > 0) {
    fields.shift()
    droppedPartial = true
  }

  const files: ChangedPath[] = []
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? ''
    if (field.startsWith('1 ')) {
      const record = splitRecord(field, 8)
      if (record !== undefined) files.push({ path: record.path, status: letterOf(record.tokens[1] ?? '') })
    } else if (field.startsWith('2 ')) {
      const record = splitRecord(field, 9)
      const renamedFrom = fields[index + 1]
      index += 1
      if (record !== undefined) {
        files.push({
          path: record.path,
          status: letterOf(record.tokens[1] ?? ''),
          ...(renamedFrom === undefined ? {} : { renamedFrom }),
        })
      }
    } else if (field.startsWith('u ')) {
      const record = splitRecord(field, 10)
      if (record !== undefined) files.push({ path: record.path, status: 'U' })
    } else if (field.startsWith('? ')) {
      files.push({ path: field.slice(2), status: '?' })
    }
  }

  return { files, droppedPartial }
}

/**
 * The repository-relative path a numstat row's third field names.
 *
 * A rename prints as `old => new`, or `dir/{old => new}` when only the basename changed, so the
 * row cannot be joined to a porcelain path without undoing that form.
 * @param raw - the row's path field, tabs already removed.
 * @returns the new path.
 */
export function numstatPath(raw: string): string {
  const braced = /\{(.*?) => (.*?)\}/.exec(raw)
  if (braced !== null && braced.index !== undefined) {
    return raw.slice(0, braced.index) + (braced[2] ?? '') + raw.slice(braced.index + braced[0].length)
  }
  const arrow = raw.indexOf(' => ')
  return arrow === -1 ? raw : raw.slice(arrow + 4)
}

/**
 * Parse `git diff --numstat`.
 * @param output - the command's stdout, one `added<TAB>removed<TAB>path` row per file.
 * @returns counts keyed by the file's new path; `null` counts mean the row was binary (`-`).
 */
export function parseNumstat(output: string): Map<string, DiffCounts> {
  const rows = new Map<string, DiffCounts>()
  for (const line of output.split('\n')) {
    if (line === '') continue
    const [added, removed, ...path] = line.split('\t')
    if (added === undefined || removed === undefined || path.length === 0) continue
    rows.set(numstatPath(path.join('\t')), {
      added: added === '-' ? null : Number.parseInt(added, 10),
      removed: removed === '-' ? null : Number.parseInt(removed, 10),
    })
  }
  return rows
}

/**
 * Whether a unified diff is git's binary notice rather than text.
 * @param unified - the diff text.
 * @returns true for `Binary files … differ` and for a `GIT binary patch` body.
 */
export function isBinaryDiff(unified: string): boolean {
  return /^(Binary files .* differ|GIT binary patch)$/m.test(unified)
}

/** One hunk of a unified diff, in the shape the browser numbers. */
export interface DiffHunk {
  /** The `@@ -a,b +c,d @@` line, kept verbatim for the header row. */
  readonly header: string
  /** First line of the hunk on the old side. */
  readonly oldStart: number
  /** First line of the hunk on the new side. */
  readonly newStart: number
  /** The hunk's lines with their `+`/`-`/space prefixes; a `\` line is git's own note. */
  readonly lines: readonly string[]
}

/** Hunk header, whose two starts are where the following lines begin counting. */
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Split a unified diff into the hunks the browser draws.
 *
 * Everything before the first hunk — `diff --git`, `index`, the `---`/`+++` pair, mode and rename
 * lines — is dropped: the tab already names the file, and those lines say nothing the status record
 * did not. The lines keep their prefixes so the numbering and the sign column stay the browser's job.
 * @param unified - git's diff text.
 * @returns the hunks, in order; empty for a diff that has none (equal sides, or a binary notice).
 */
export function parseUnifiedHunks(unified: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let current: { header: string; oldStart: number; newStart: number; lines: string[] } | undefined

  for (const line of unified.split('\n')) {
    const match = HUNK_HEADER.exec(line)
    if (match !== null) {
      current = {
        header: line,
        oldStart: Number.parseInt(match[1] ?? '0', 10),
        newStart: Number.parseInt(match[2] ?? '0', 10),
        lines: [],
      }
      hunks.push(current)
      continue
    }
    if (current === undefined || line === '') continue
    const marker = line.at(0)
    if (marker !== '+' && marker !== '-' && marker !== ' ' && marker !== '\\') continue
    current.lines.push(line)
  }

  return hunks
}

/**
 * Attach counts to one changed path.
 * @param file - the porcelain record.
 * @param counts - numstat rows keyed by new path.
 * @returns the row the changes response sends.
 */
export function withCounts(file: ChangedPath, counts: ReadonlyMap<string, DiffCounts>): ChangedFile {
  const row = counts.get(file.path)
  return { ...file, added: row?.added ?? null, removed: row?.removed ?? null }
}
