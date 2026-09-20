import { describe, expect, it } from 'vitest'
import {
  headCommand,
  isBinaryDiff,
  numstatCommand,
  numstatPath,
  parseNumstat,
  parsePorcelainV2,
  parseUnifiedHunks,
  quoteShellArg,
  statusCommand,
  trackedDiffCommand,
  UNTRACKED_COUNT_LIMIT,
  untrackedDiffCommand,
  untrackedNumstatCommand,
  withCounts,
} from '../src/git.ts'

/** NUL, spelled out because the porcelain format is defined in terms of it. */
const NUL = '\0'

describe('parsePorcelainV2', () => {
  it('reads ordinary, untracked and unmerged records', () => {
    const output = [
      '1 M. N... 100644 100644 100644 aaa bbb src/app.ts',
      '? notes/new file.txt',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflict.ts',
    ].join(NUL) + NUL

    const { files, droppedPartial } = parsePorcelainV2(output, false)

    expect(droppedPartial).toBe(false)
    expect(files).toEqual([
      { path: 'src/app.ts', status: 'M' },
      { path: 'notes/new file.txt', status: '?' },
      { path: 'src/conflict.ts', status: 'U' },
    ])
  })

  it('takes both paths of a rename and leaves no phantom entry', () => {
    const output = '2 R. N... 100644 100644 100644 aaa bbb R100 sub/renamed.txt'
      + NUL + 'sub/文 件.txt' + NUL

    expect(parsePorcelainV2(output, false).files).toEqual([
      { path: 'sub/renamed.txt', status: 'R', renamedFrom: 'sub/文 件.txt' },
    ])
  })

  it('collapses the XY field to the letter the list shows', () => {
    const output = [
      '1 .M N... 100644 100644 100644 aaa bbb modified.ts',
      '1 A. N... 000000 100644 100644 0000000 bbb added.ts',
      '1 D. N... 100644 000000 000000 aaa 0000000 deleted.ts',
      '1 C. N... 100644 100644 100644 aaa bbb copied.ts',
    ].join(NUL) + NUL

    expect(parsePorcelainV2(output, false).files.map((file) => file.status)).toEqual(['M', 'A', 'D', 'C'])
  })

  it('drops the partial first record of truncated output', () => {
    const output = 'src/hal' + NUL + '1 M. N... 100644 100644 100644 aaa bbb src/second.ts' + NUL

    const { files, droppedPartial } = parsePorcelainV2(output, true)

    expect(droppedPartial).toBe(true)
    expect(files).toEqual([{ path: 'src/second.ts', status: 'M' }])
  })
})

describe('numstat', () => {
  it('keys counts by path and marks binary rows', () => {
    const rows = parseNumstat('3\t1\tsrc/app.ts\n-\t-\tassets/logo.png\n')

    expect(rows.get('src/app.ts')).toEqual({ added: 3, removed: 1 })
    expect(rows.get('assets/logo.png')).toEqual({ added: null, removed: null })
  })

  it('resolves both rename spellings to the new path', () => {
    expect(numstatPath('old.txt => new.txt')).toBe('new.txt')
    expect(numstatPath('sub/{文 件.txt => renamed.txt}')).toBe('sub/renamed.txt')
    expect(numstatPath('plain/path.ts')).toBe('plain/path.ts')
    expect(parseNumstat('0\t0\tdir/{a.txt => b.txt}\n').has('dir/b.txt')).toBe(true)
  })

  it('leaves an uncounted file unknown instead of guessing zero', () => {
    expect(withCounts({ path: 'notes/new.txt', status: '?' }, new Map())).toEqual({
      path: 'notes/new.txt',
      status: '?',
      added: null,
      removed: null,
    })
  })

  it('takes the counts of a no-index row, including the binary marker', () => {
    const counts = parseNumstat('-\t-\t/dev/null => blob.bin\n3\t0\t/dev/null => three.txt\n')

    expect(withCounts({ path: 'three.txt', status: '?' }, counts)).toEqual({
      path: 'three.txt',
      status: '?',
      added: 3,
      removed: 0,
    })
    expect(withCounts({ path: 'blob.bin', status: '?' }, counts)).toEqual({
      path: 'blob.bin',
      status: '?',
      added: null,
      removed: null,
    })
  })
})

describe('commands', () => {
  it('turns quotepath off wherever git prints a path', () => {
    expect(statusCommand()).toContain('-c core.quotepath=false')
    expect(numstatCommand(false)).toContain('-c core.quotepath=false')
    expect(trackedDiffCommand('a.ts', false)).toContain('-c core.quotepath=false')
    expect(untrackedDiffCommand('a.ts')).toContain('-c core.quotepath=false')
  })

  it('stops repository config from replacing git\'s hunks', () => {
    expect(trackedDiffCommand('a.ts', false)).toContain('--no-ext-diff --no-textconv')
    expect(untrackedDiffCommand('a.ts')).toContain('--no-ext-diff --no-textconv')
  })

  it('diffs against HEAD, against the index when HEAD does not exist yet, and against /dev/null', () => {
    expect(trackedDiffCommand('a.ts', false)).toContain(' -U3 HEAD -- ')
    expect(trackedDiffCommand('a.ts', true)).toContain(' -U3 --cached -- ')
    expect(untrackedDiffCommand('a.ts')).toContain(' -U3 /dev/null ')
    expect(numstatCommand(true)).toContain('--cached')
  })

  it('quotes a path so the shell reproduces it byte for byte', () => {
    expect(quoteShellArg("it's here.txt")).toBe("'it'\\''s here.txt'")
    expect(trackedDiffCommand("it's here.txt", false)).toContain("-- 'it'\\''s here.txt'")
    expect(untrackedDiffCommand("it's here.txt")).toContain("/dev/null 'it'\\''s here.txt'")
  })

  it('builds one quoted command per untracked file, and nothing for an empty list', () => {
    expect(untrackedNumstatCommand([])).toBeUndefined()
    expect(untrackedNumstatCommand(['notes/new file.txt', "it's.txt"])).toBe(
      "git -c core.quotepath=false diff --no-index --numstat /dev/null -- 'notes/new file.txt'; "
      + "git -c core.quotepath=false diff --no-index --numstat /dev/null -- 'it'\\''s.txt'",
    )
  })

  it('caps the untracked pass so a huge set does not cost a process each', () => {
    const many = Array.from({ length: UNTRACKED_COUNT_LIMIT + 5 }, (_, index) => 'file-' + index + '.txt')
    const command = untrackedNumstatCommand(many)
    expect(command?.split('; ')).toHaveLength(UNTRACKED_COUNT_LIMIT)
  })

  it('detects an unborn HEAD by exit code, so the command only has to be cheap', () => {
    expect(headCommand()).toBe('git rev-parse --verify HEAD')
  })

  it('recognizes git binary notices', () => {
    expect(isBinaryDiff('diff --git a/a b/a\nBinary files a/a and b/a differ\n')).toBe(true)
    expect(isBinaryDiff('GIT binary patch\n')).toBe(true)
    expect(isBinaryDiff('--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b\n')).toBe(false)
  })
})

describe('parseUnifiedHunks', () => {
  it('keeps a hunk header and its prefixed lines, and drops the file header', () => {
    const hunks = parseUnifiedHunks([
      'diff --git a/a.ts b/a.ts',
      'index 111..222 100644',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -94,3 +94,4 @@ const body = () => {',
      ' const a = 1',
      '-const b = 2',
      '+const b = 3',
      '+const c = 4',
    ].join('\n'))

    expect(hunks).toEqual([{
      header: '@@ -94,3 +94,4 @@ const body = () => {',
      oldStart: 94,
      newStart: 94,
      lines: [' const a = 1', '-const b = 2', '+const b = 3', '+const c = 4'],
    }])
  })

  it('reads every hunk of a scattered edit', () => {
    const hunks = parseUnifiedHunks([
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '@@ -40,2 +40,2 @@',
      ' c',
      '+d',
    ].join('\n'))

    expect(hunks.map((hunk) => [hunk.oldStart, hunk.newStart, hunk.lines.length]))
      .toEqual([[1, 1, 2], [40, 40, 2]])
  })

  it('keeps git\'s no-newline note inside its hunk', () => {
    const hunks = parseUnifiedHunks('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n')

    expect(hunks[0]?.lines).toEqual(['-a', '\\ No newline at end of file', '+b'])
  })

  it('reads a diff with no hunks as no hunks', () => {
    expect(parseUnifiedHunks('')).toEqual([])
    expect(parseUnifiedHunks('Binary files a/x and b/x differ\n')).toEqual([])
  })
})
