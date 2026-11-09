#!/usr/bin/env tsx
/**
 * Write or check the repository's plugin market index (format 1).
 *
 *   pnpm market:index [--commit <ref>] [--out <file>] [--repo-url <url>]
 *                     [--title <text>] [--description <text>] [--author <name>]
 *   pnpm verify:market
 *
 * The index pins Git commits, so run it after a push. The default commit is HEAD; the default
 * repository URL is remote.origin.url.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildMarketIndex,
  readMarketIndex,
  remoteBranchesContaining,
  verifyMarketIndex,
} from '../tooling/market-index/src/index.ts'

/** Repository root, derived from this script's own path so the working directory never matters. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const USAGE = 'usage: pnpm market:index [--commit <ref>] [--out <file>] [--repo-url <url>] [--title <text>] [--description <text>] [--author <name>] [--allow-unpushed]\n       pnpm verify:market [--out <file>] [--repo-url <url>]'

interface Options {
  commit: string
  out: string
  repoUrl?: string
  title?: string
  description?: string
  author?: string
  check: boolean
  allowUnpushed: boolean
}

/**
 * Read the command line.
 * @param argv - arguments after the script name.
 * @returns the parsed options.
 */
function parse(argv: string[]): Options {
  const options: Options = {
    commit: 'HEAD',
    out: join(ROOT, 'index.json'),
    check: false,
    allowUnpushed: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') {
      options.check = true
      continue
    }
    if (arg === '--allow-unpushed') {
      options.allowUnpushed = true
      continue
    }
    if (arg === '--help' || arg === '-h') throw new Error(USAGE)
    if (arg === undefined || !arg.startsWith('--')) throw new Error('unexpected argument ' + JSON.stringify(arg) + '\n' + USAGE)

    const value = argv[index + 1]
    if (value === undefined) throw new Error(arg + ' needs a value\n' + USAGE)
    index += 1

    switch (arg) {
      case '--commit': options.commit = value; break
      case '--out': options.out = resolve(value); break
      case '--repo-url': options.repoUrl = value; break
      case '--title': options.title = value; break
      case '--description': options.description = value; break
      case '--author': options.author = value; break
      default: throw new Error('unknown option ' + arg + '\n' + USAGE)
    }
  }

  return options
}

/**
 * The configured origin URL, when there is one.
 * @returns the URL, or undefined.
 */
function originUrl(): string | undefined {
  try {
    const value = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}

/**
 * Whether the working tree or the index differs from HEAD.
 * @returns whether there is anything uncommitted.
 */
function workingTreeDirty(): boolean {
  try {
    return execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim() !== ''
  } catch {
    return false
  }
}

/**
 * The configured git user name, when there is one.
 * @returns the name, or undefined.
 */
function gitUser(): string | undefined {
  try {
    const value = execFileSync('git', ['config', '--get', 'user.name'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}

/**
 * Print where the index points.
 * @param commit - the pinned SHA.
 * @param repoUrl - the canonical repository URL.
 * @param count - number of listed plugins.
 */
function summary(commit: string, repoUrl: string, count: number): void {
  process.stdout.write('commit     ' + commit + '\n')
  process.stdout.write('repository ' + repoUrl + '\n')
  process.stdout.write('plugins    ' + String(count) + '\n')
}

let options: Options
try {
  options = parse(process.argv.slice(2))
} catch (error) {
  process.stderr.write('✗ ' + (error instanceof Error ? error.message : String(error)) + '\n')
  process.exit(1)
}

const repoUrl = options.repoUrl ?? originUrl()
const author = options.author ?? gitUser()

if (options.check) {
  let index
  try {
    index = readMarketIndex(options.out)
  } catch (error) {
    process.stderr.write('✗ ' + (error instanceof Error ? error.message : String(error)) + '\n')
    process.stderr.write('  run pnpm market:index after committing the plugin changes\n')
    process.exit(1)
  }

  const problems = verifyMarketIndex({
    root: ROOT,
    index,
    ...(repoUrl === undefined ? {} : { repoUrl }),
  })

  for (const problem of problems) {
    process.stderr.write('  ' + problem.plugin + '@' + problem.version + ': ' + problem.message + '\n')
  }

  const commits = new Set<string>()
  for (const plugin of index.plugins) {
    for (const version of plugin.versions) {
      if (version.source.type === 'git') commits.add(version.source.commit)
    }
  }
  for (const commit of commits) {
    if (remoteBranchesContaining(ROOT, commit).length === 0) {
      process.stderr.write('  warn: ' + commit + ' is not on a remote-tracking branch; push it before using this index\n')
    }
  }

  if (problems.length > 0) {
    process.stderr.write('\n✗ verify:market: ' + String(problems.length) + ' problems\n')
    process.exit(1)
  }

  process.stdout.write('✓ ' + options.out + ' is valid and matches its pinned commits\n')
  process.stdout.write('plugins    ' + String(index.plugins.length) + '\n')
  process.stdout.write('versions   ' + String(index.plugins.reduce((sum, plugin) => sum + plugin.versions.length, 0)) + '\n')
  process.exit(0)
}

if (workingTreeDirty()) {
  process.stderr.write('  warn: the working tree has uncommitted changes; the index lists the commit, not them\n')
}

let result
try {
  result = buildMarketIndex({
    root: ROOT,
    commit: options.commit,
    ...(repoUrl === undefined ? {} : { repoUrl }),
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(author === undefined ? {} : { author }),
  })
} catch (error) {
  process.stderr.write('✗ ' + (error instanceof Error ? error.message : String(error)) + '\n')
  process.exit(1)
}

for (const warning of result.warnings) process.stderr.write('  warn: ' + warning + '\n')

const remoteBranches = remoteBranchesContaining(ROOT, result.commit)
if (remoteBranches.length === 0 && !options.allowUnpushed) {
  process.stderr.write('✗ ' + result.commit + ' is not on a remote-tracking branch. Push it first, or pass --allow-unpushed for a local dry run.\n')
  process.exit(1)
}

writeFileSync(options.out, JSON.stringify(result.index, null, 2) + '\n')
summary(result.commit, result.repoUrl, result.index.plugins.length)
process.stdout.write('index      ' + options.out + '\n')

if (remoteBranches.length === 0) {
  process.stderr.write('  warn: ' + result.commit + ' is not on a remote-tracking branch; this index is not installable yet\n')
}
