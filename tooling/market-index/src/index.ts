/**
 * Build and verify this repository's plugin market index, format 1.
 *
 * The index is a release artifact: every listed version pins one Git commit, so it is generated
 * after a push rather than from the working tree. This module reads the manifests at the pinned
 * commit, derives the display fields DSH reads, and runs the official validator before returning.
 * @module market-index
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { posix } from 'node:path'
import {
  MarketIndexError,
  parseMarketIndex,
  type MarketIndex,
} from '@deepseek-ai/dsh-plugin-market-index'

/** A URL no icon or document ever resolves against; the index has no relative references. */
const INDEX_URL = 'https://market-index.invalid/index.json'

/** npm's package-name validator, as the market format states it. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
const PACKAGE_NAME_MAX_LENGTH = 214

/** One exact SemVer 2.0.0 version; the market format rejects ranges here. */
const SEMVER = new RegExp(
  '^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)'
  + '(?:-(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)'
  + '(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?'
  + '(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$',
  'u',
)

/** A segment the market format accepts in a Git source's package directory. */
const PATH_SEGMENT = /^[A-Za-z0-9._@+-]+$/u

/** What to build. */
export interface BuildOptions {
  /** Repository root. */
  root: string
  /** Commit-ish to read; defaults to HEAD. */
  commit?: string
  /** Canonical https repository URL; defaults to remote.origin.url. */
  repoUrl?: string
  /** English index title; defaults to dsh-plugins. */
  title?: string
  /** English index description. */
  description?: string
  /** Author used when a manifest declares none. */
  author?: string
}

/** What was built. */
export interface BuildResult {
  /** The validated index, ready to serialize. */
  index: MarketIndex
  /** Manifests that were skipped, with the reason. */
  warnings: string[]
  /** The resolved full commit SHA the index pins. */
  commit: string
  /** The canonical https repository URL the index names. */
  repoUrl: string
}

/** One inconsistency between a committed index and the repository it points at. */
export interface VerifyProblem {
  /** Plugin package name. */
  plugin: string
  /** Listed version. */
  version: string
  /** What disagrees. */
  message: string
}

/** A plain object, as opposed to an array or null. */
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Run git and return its stdout.
 * @param root - repository root.
 * @param args - git arguments.
 * @returns stdout, unchanged.
 */
function git(root: string, args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    // The module probes for absent objects (a missing patch, an unpushed commit); the thrown error
    // carries stderr, so do not also print it on every expected miss.
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/**
 * Resolve a commit-ish to a full SHA.
 * @param root - repository root.
 * @param ref - commit-ish.
 * @returns the full lowercase SHA.
 * @throws when the object is not a commit in this repository.
 */
export function resolveCommit(root: string, ref: string): string {
  try {
    return git(root, ['rev-parse', '--verify', ref + '^{commit}']).trim()
  } catch {
    throw new Error('cannot resolve ' + JSON.stringify(ref) + ' to a commit in ' + root)
  }
}

/**
 * The canonical https URL of a Git remote, as the market format requires.
 *
 * Accepts the scp-like form (git@github.com:owner/repo.git), ssh://, https://, and the github:
 * shorthand. Credentials, queries, fragments, non-https transports, and repositories with fewer than
 * two path segments are refused.
 * @param remote - a remote URL or shorthand.
 * @returns https://host/owner/repo, without a .git suffix.
 */
export function normalizeRepositoryUrl(remote: string): string {
  const text = remote.trim()
  if (text === '') throw new Error('repository URL is empty')

  let host: string
  let path: string

  const shorthand = /^github:(.+)$/u.exec(text)
  if (shorthand?.[1] !== undefined) {
    host = 'github.com'
    path = shorthand[1]
  } else if (text.startsWith('git@') && !text.includes('://')) {
    const scp = /^git@([^:]+):(.+)$/u.exec(text)
    if (scp?.[1] === undefined || scp[2] === undefined) throw new Error('cannot read repository URL ' + JSON.stringify(remote))
    host = scp[1]
    path = scp[2]
  } else {
    let url: URL
    try {
      url = new URL(text.replace(/^git\+/u, ''))
    } catch {
      throw new Error('cannot read repository URL ' + JSON.stringify(remote))
    }
    if (url.protocol !== 'https:' && url.protocol !== 'ssh:') {
      throw new Error('repository URL must use https or ssh, got ' + url.protocol)
    }
    // SSH remotes normally carry the `git` user name; an https URL must not carry one.
    if (url.password !== '' || url.search !== '' || url.hash !== '' || (url.protocol === 'https:' && url.username !== '')) {
      throw new Error('repository URL must not contain credentials, a query, or a fragment')
    }
    host = url.hostname
    path = url.pathname
  }

  const segments = path.replace(/\.git$/u, '').split('/').filter((segment) => segment !== '')
  if (segments.length < 2) throw new Error('repository URL must name at least owner/repo, got ' + JSON.stringify(remote))
  return 'https://' + host + '/' + segments.join('/')
}

/**
 * A display web URL, which the format allows over http as well as https.
 * @param value - a manifest repository URL or shorthand.
 * @returns the canonical web URL, or undefined when it is not one.
 */
function webUrl(value: string): string | undefined {
  const text = value.trim().replace(/^git\+/u, '')
  if (text.startsWith('github:')) {
    const path = text.slice('github:'.length).replace(/\.git$/u, '')
    return /^[^/]+\/[^/]+$/u.test(path) ? 'https://github.com/' + path : undefined
  }
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return undefined
    const path = url.pathname.replace(/\.git$/u, '').replace(/\/+$/u, '')
    return url.protocol + '//' + url.host + path
  } catch {
    return undefined
  }
}

/**
 * The manifest homepage, which the format allows to carry a query or fragment.
 * @param value - the manifest homepage.
 * @returns the absolute http(s) URL, or undefined.
 */
function homepageUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether a string is a package directory the market format accepts.
 * @param value - a POSIX relative path.
 * @returns whether every segment is a plain path segment.
 */
function isDirectory(value: string): boolean {
  if (value === '') return false
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..' && PATH_SEGMENT.test(segment))
}

/**
 * The DSH range the market index must publish for a manifest.
 *
 * An explicit engines.dsh wins. Otherwise the exact DSH peer ranges are used, as the upstream
 * generator does. A workspace protocol range is not publishable, and several different peer ranges
 * cannot be intersected here, so both cases ask for an explicit declaration instead of guessing.
 * @param manifest - a parsed package.json.
 * @returns the SemVer range to list.
 * @throws when no range can be derived.
 */
export function inferDshRange(manifest: unknown): string {
  const root = record(manifest)
  if (root === undefined) throw new Error('package.json is not an object')

  const engines = record(root['engines'])
  const declared = engines?.['dsh']
  if (typeof declared === 'string' && declared.trim() !== '') {
    const range = declared.trim()
    if (range.startsWith('workspace:')) throw new Error('engines.dsh uses the unpublishable range ' + range)
    return range
  }

  const peers = record(root['peerDependencies']) ?? {}
  const ranges = new Set<string>()
  for (const [name, value] of Object.entries(peers)) {
    if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
    if (typeof value !== 'string') throw new Error(name + ' peer range is not a string')
    const range = value.trim()
    if (range === 'workspace:*' || range === 'workspace:^' || range === 'workspace:~') continue
    if (range.startsWith('workspace:')) throw new Error(name + ' uses the unpublishable range ' + range)
    ranges.add(range)
  }

  if (ranges.size === 0) throw new Error('no engines.dsh and no @deepseek-ai/dsh* peer range')
  if (ranges.size > 1) {
    throw new Error('several different DSH peer ranges (' + [...ranges].join(', ') + '); declare engines.dsh')
  }
  const only = ranges.values().next().value
  if (typeof only !== 'string') throw new Error('no engines.dsh and no @deepseek-ai/dsh* peer range')
  return only
}

/**
 * The patch files a bundle manifest declares.
 * @param manifest - a parsed package.json.
 * @returns the non-empty list, or undefined when dsh.bundle.patch is absent or malformed.
 */
function bundlePatches(manifest: Record<string, unknown>): string[] | undefined {
  const bundle = record(record(manifest['dsh'])?.['bundle'])
  const patch = bundle?.['patch']
  if (typeof patch === 'string' && patch !== '') return [patch]
  if (Array.isArray(patch) && patch.length > 0 && patch.every((entry) => typeof entry === 'string' && entry !== '')) {
    return patch as string[]
  }
  return undefined
}

/**
 * The first declared patch file that is absent at the commit.
 * @param root - repository root.
 * @param commit - full SHA.
 * @param dir - package directory.
 * @param patches - declared patch paths, relative to the package.
 * @returns the missing path, or undefined when every patch exists.
 */
function missingPatch(root: string, commit: string, dir: string, patches: readonly string[]): string | undefined {
  for (const patch of patches) {
    const relative = patch.replace(/^\.\//u, '')
    if (relative.startsWith('/') || relative.split('/').some((segment) => segment === '..')) return patch
    const path = posix.normalize(dir + '/' + relative)
    if (!path.startsWith(dir + '/')) return patch
    try {
      git(root, ['cat-file', '-e', commit + ':' + path])
    } catch {
      return patch
    }
  }
  return undefined
}

/** One package manifest found in a commit. */
interface PackageAtCommit {
  /** Repository-relative package directory, POSIX separators. */
  dir: string
  /** Parsed package.json. */
  manifest: Record<string, unknown>
}

/**
 * Every plugins/name/package.json at one commit, in directory order.
 * @param root - repository root.
 * @param commit - full SHA.
 * @param warnings - collects unreadable manifests.
 * @returns the packages that could be read.
 */
function packagesAt(root: string, commit: string, warnings: string[]): PackageAtCommit[] {
  const files = git(root, ['ls-tree', '-r', '-z', '--name-only', commit, '--', 'plugins']).split('\0')
  const dirs = new Set<string>()
  for (const file of files) {
    const match = /^plugins\/([^/]+)\/package\.json$/u.exec(file)
    if (match?.[1] !== undefined) dirs.add('plugins/' + match[1])
  }

  const packages: PackageAtCommit[] = []
  for (const dir of [...dirs].sort()) {
    try {
      const raw = git(root, ['show', commit + ':' + dir + '/package.json'])
      const manifest = record(JSON.parse(raw))
      if (manifest === undefined) {
        warnings.push(dir + '/package.json: skipped because it is not a JSON object')
        continue
      }
      packages.push({ dir, manifest })
    } catch (error) {
      warnings.push(dir + '/package.json: skipped because it could not be read (' + (error instanceof Error ? error.message : String(error)) + ')')
    }
  }
  return packages
}

/**
 * The author's name, from npm's string or object form.
 * @param manifest - a parsed package.json.
 * @param fallback - used when the manifest declares no name.
 * @returns the name, or undefined.
 */
function authorName(manifest: Record<string, unknown>, fallback: string | undefined): string | undefined {
  const author = manifest['author']
  if (typeof author === 'string' && author.trim() !== '') return author.trim()
  const object = record(author)
  if (typeof object?.['name'] === 'string' && object['name'].trim() !== '') return object['name'].trim()
  return fallback
}

/**
 * The display repository fields, from the manifest when usable, else this repository.
 * @param manifest - a parsed package.json.
 * @param dir - the package directory.
 * @param repoUrl - this repository's canonical URL.
 * @returns the market repository record.
 */
function repositoryFor(
  manifest: Record<string, unknown>,
  dir: string,
  repoUrl: string,
): { url: string; directory: string } {
  const declared = record(manifest['repository'])
  if (typeof declared?.['url'] === 'string') {
    const url = webUrl(declared['url'])
    const directory = declared['directory']
    if (url !== undefined) {
      return {
        url,
        directory: typeof directory === 'string' && isDirectory(directory) ? directory : dir,
      }
    }
  }
  return { url: repoUrl, directory: dir }
}

/**
 * Build the index from one commit.
 * @param options - what to build.
 * @returns the validated index and any skipped manifests.
 */
export function buildMarketIndex(options: BuildOptions): BuildResult {
  const commit = resolveCommit(options.root, options.commit ?? 'HEAD')
  const repoUrl = normalizeRepositoryUrl(
    options.repoUrl ?? git(options.root, ['config', '--get', 'remote.origin.url']),
  )
  const publishTimestamp = Number(git(options.root, ['show', '-s', '--format=%ct', commit]).trim())
  if (!Number.isInteger(publishTimestamp) || publishTimestamp < 0) {
    throw new Error('cannot read the committer time of ' + commit)
  }

  const warnings: string[] = []
  const plugins: unknown[] = []

  for (const { dir, manifest } of packagesAt(options.root, commit, warnings)) {
    const at = dir + '/package.json'
    if (manifest['private'] === true) {
      warnings.push(at + ': skipped because it is private')
      continue
    }

    const name = manifest['name']
    if (typeof name !== 'string' || name.length > PACKAGE_NAME_MAX_LENGTH || !PACKAGE_NAME.test(name)) {
      warnings.push(at + ': skipped because name is not a valid npm package name')
      continue
    }

    const version = manifest['version']
    if (typeof version !== 'string' || !SEMVER.test(version)) {
      warnings.push(at + ': skipped because version is not an exact SemVer version')
      continue
    }

    const patches = bundlePatches(manifest)
    if (patches === undefined) {
      warnings.push(at + ': skipped because dsh.bundle.patch is missing or malformed')
      continue
    }
    const missing = missingPatch(options.root, commit, dir, patches)
    if (missing !== undefined) {
      warnings.push(at + ': skipped because ' + missing + ' is not at ' + commit)
      continue
    }

    let dsh: string
    try {
      dsh = inferDshRange(manifest)
    } catch (error) {
      warnings.push(at + ': skipped because ' + (error instanceof Error ? error.message : String(error)))
      continue
    }

    const description = typeof manifest['description'] === 'string' && manifest['description'].trim() !== ''
      ? manifest['description']
      : undefined
    const author = authorName(manifest, options.author)
    const homepage = typeof manifest['homepage'] === 'string' ? homepageUrl(manifest['homepage']) : undefined
    const keywords = Array.isArray(manifest['keywords'])
      ? manifest['keywords'].filter((keyword): keyword is string => typeof keyword === 'string')
      : []

    plugins.push({
      name,
      ...(description === undefined ? {} : { description }),
      ...(author === undefined ? {} : { author }),
      ...(homepage === undefined ? {} : { homepage }),
      ...(keywords.length === 0 ? {} : { metadata: { keywords } }),
      repository: repositoryFor(manifest, dir, repoUrl),
      versions: [{
        version,
        publishTimestamp,
        source: { type: 'git', url: repoUrl, commit, path: dir },
        engines: { dsh },
      }],
    })
  }

  const raw = {
    format: 1,
    title: { en: options.title ?? 'dsh-plugins' },
    description: {
      en: options.description
        ?? 'Personal DeepSeek Harness plugin bundles, installed from pinned Git commits.',
    },
    plugins,
  }

  try {
    return { index: parseMarketIndex(raw, INDEX_URL), warnings, commit, repoUrl }
  } catch (error) {
    if (error instanceof MarketIndexError) throw new Error(error.path + ' ' + error.reason)
    throw error
  }
}

/**
 * Read and validate a committed index.
 * @param path - the index file.
 * @returns the validated index.
 * @throws when the file is missing, not JSON, or violates format 1.
 */
export function readMarketIndex(path: string): MarketIndex {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error('cannot read ' + path + ': ' + (error instanceof Error ? error.message : String(error)))
  }
  try {
    return parseMarketIndex(raw, INDEX_URL)
  } catch (error) {
    if (error instanceof MarketIndexError) throw new Error(path + ': ' + error.path + ' ' + error.reason)
    throw error
  }
}

/**
 * Check every listed version against the package manifest at its pinned commit.
 *
 * This is deliberately independent of HEAD: the index is allowed to lag the branch, but it must
 * describe a commit that exists locally and a manifest that still matches the entry.
 * @param options - what to check.
 * @returns the inconsistencies, empty when the index is sound.
 */
export function verifyMarketIndex(options: {
  root: string
  index: MarketIndex
  repoUrl?: string
}): VerifyProblem[] {
  const problems: VerifyProblem[] = []
  let expectedUrl: string | undefined
  if (options.repoUrl !== undefined) {
    try {
      expectedUrl = normalizeRepositoryUrl(options.repoUrl)
    } catch (error) {
      problems.push({
        plugin: '(index)',
        version: '(index)',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  for (const plugin of options.index.plugins) {
    for (const version of plugin.versions) {
      const problem = (message: string): void => {
        problems.push({ plugin: plugin.name, version: version.version, message })
      }

      if (version.source.type !== 'git') {
        problem('lists an npm source; this repository publishes only pinned Git sources')
        continue
      }
      if (expectedUrl !== undefined && version.source.url !== expectedUrl) {
        problem('source URL ' + version.source.url + ' is not ' + expectedUrl)
      }

      const commit = version.source.commit
      let resolved: string
      try {
        resolved = resolveCommit(options.root, commit)
      } catch {
        problem('commit ' + commit + ' is not in this repository; push it before publishing this index')
        continue
      }

      const dir = version.source.path ?? ''
      if (dir !== '' && !isDirectory(dir)) {
        problem('source path ' + JSON.stringify(dir) + ' is not a plain relative directory')
        continue
      }

      let manifest: Record<string, unknown>
      try {
        manifest = record(JSON.parse(git(options.root, ['show', resolved + ':' + (dir === '' ? '' : dir + '/') + 'package.json']))) ?? {}
      } catch (error) {
        problem('cannot read ' + (dir === '' ? '.' : dir) + '/package.json at ' + commit + ': ' + (error instanceof Error ? error.message : String(error)))
        continue
      }

      if (manifest['name'] !== plugin.name) problem('manifest name is ' + JSON.stringify(manifest['name']) + ', not ' + plugin.name)
      if (manifest['version'] !== version.version) problem('manifest version is ' + JSON.stringify(manifest['version']) + ', not ' + version.version)
      if (manifest['private'] === true) problem('manifest is private and must not be listed')

      const patches = bundlePatches(manifest)
      if (patches === undefined) {
        problem('manifest declares no dsh.bundle.patch')
      } else {
        const missing = missingPatch(options.root, resolved, dir, patches)
        if (missing !== undefined) problem(missing + ' is not at ' + commit)
      }

      try {
        const inferred = inferDshRange(manifest)
        if (inferred !== version.engines.dsh) {
          problem('engines.dsh is ' + JSON.stringify(version.engines.dsh) + ', but the manifest requires ' + JSON.stringify(inferred))
        }
      } catch (error) {
        problem(error instanceof Error ? error.message : String(error))
      }

      const timestamp = Number(git(options.root, ['show', '-s', '--format=%ct', resolved]).trim())
      if (timestamp !== version.publishTimestamp) {
        problem('publishTimestamp is ' + version.publishTimestamp + ', but ' + commit + ' was committed at ' + timestamp)
      }
    }
  }

  return problems
}

/**
 * Whether a commit is on any remote-tracking branch.
 * @param root - repository root.
 * @param commit - full SHA.
 * @returns the matching remote branch names.
 */
export function remoteBranchesContaining(root: string, commit: string): string[] {
  try {
    return git(root, ['branch', '-r', '--contains', commit])
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
  } catch {
    return []
  }
}
