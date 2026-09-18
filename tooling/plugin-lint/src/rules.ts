import { readFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import type { Finding, Rule } from './types.ts'

/** Paths as the manifest writes them: POSIX separators, no leading `./`, no trailing slash. */
function normalize(path: string): string {
  return posix.normalize(path.replace(/^\.\//, '')).replace(/\/+$/, '')
}

/** A plain object, as opposed to an array or `null`; the manifest is raw JSON, so every field is `unknown`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The file the host ends up loading: the `default` condition, else the first condition that resolves.
 * @param value - one `exports` leaf.
 * @returns the package-relative path, or undefined when no string is reachable.
 */
function runtimeTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return undefined
  for (const condition of ['default', 'import', 'require'] as const) {
    const resolved = runtimeTarget(value[condition])
    if (resolved !== undefined) return resolved
  }
  return undefined
}

/** The `dsh` field's value under `key`, when `dsh` is a mapping. */
function dshKey(manifest: Record<string, unknown>, key: string): unknown {
  const dsh = manifest['dsh']
  return isRecord(dsh) ? dsh[key] : undefined
}

/**
 * Whether one `files` entry covers a path.
 *
 * `files` is glob syntax, so this has to be a matcher rather than a set lookup — but only the forms
 * this repo's plugins actually write are understood: a literal path, a `**` that crosses segments,
 * and a `*` confined to one. A pattern this cannot read matches nothing, which at worst reports a
 * file the manifest does ship; it can never hide one it does not.
 * @param entry - one normalized `files` entry.
 * @param path - the normalized package-relative path to test.
 * @returns whether the entry covers the path.
 */
function covers(entry: string, path: string): boolean {
  if (!entry.includes('*')) return entry === path
  const star = entry.indexOf('*')
  const prefix = entry.slice(0, star)
  const suffix = entry.slice(star + 1)
  if (!path.startsWith(prefix) || !path.endsWith(suffix)) return false
  // `**` crosses segments; a single `*` does not, so `lib/*.js` must not match `lib/a/b.js`.
  if (suffix.startsWith('*')) return true
  return !path.slice(prefix.length, path.length - suffix.length).includes('/')
}

/** The normalized `files` list; an absent or malformed `files` covers nothing. */
function filesList(manifest: Record<string, unknown>): string[] {
  const files = manifest['files']
  if (!Array.isArray(files)) return []
  return files.filter((entry): entry is string => typeof entry === 'string').map(normalize)
}

/**
 * L7 — a declared browser half ships exactly what the host reads it through.
 *
 * The host finds the bundle through `exports["./client"]`, and the sibling `<bundle>.map` is what
 * gives the browser devtools their sources and the HMR driver a version to hash. Both have to be
 * reachable, which means both have to survive `files`. Every missing piece fails late and obscurely:
 * a bundle the scan cannot find throws while the Web UI boots, and a bundle with no map reloads with
 * nothing to hash. This rule moves that failure into the repo, before a profile ever sees the tarball.
 *
 * `tooling/pack-check`'s P6 asserts the same contract against the built tarball, which is what
 * catches a wrong glob — the listing is the truth. L7 is the cheap, pre-build version of it.
 */
export const l7ClientHalf: Rule = {
  id: 'L7',
  async check(dir: string): Promise<Finding[]> {
    let raw: string
    try {
      raw = await readFile(join(dir, 'package.json'), 'utf8')
    } catch {
      // A directory with no manifest is not a plugin; saying so is L1's business, not this rule's.
      return []
    }

    const manifest = JSON.parse(raw) as Record<string, unknown>
    const exports = manifest['exports']
    const entry = isRecord(exports) ? exports['./client'] : undefined
    const declared = dshKey(manifest, 'client')

    if (declared === undefined && entry === undefined) return []
    if (declared !== undefined && entry === undefined) {
      return [{
        rule: 'L7',
        file: 'package.json',
        message: 'dsh.client is declared but exports has no "./client" subpath — the host resolves the browser '
          + 'bundle through that subpath, so the half would never be found',
      }]
    }
    if (declared === undefined) {
      return [{
        rule: 'L7',
        file: 'package.json',
        message: 'exports["./client"] exists but dsh.client is not declared — nothing selects this package as a '
          + 'client plugin, so the bundle would never load',
      }]
    }

    const findings: Finding[] = []
    if (!isRecord(declared) || declared['platform'] !== 'web') {
      const platform = isRecord(declared) ? declared['platform'] : undefined
      findings.push({
        rule: 'L7',
        file: 'package.json',
        message: `dsh.client.platform must be 'web', got ${JSON.stringify(platform)} — it is the only value the `
          + 'Web consumer acts on',
      })
    }

    const target = runtimeTarget(entry)
    if (target === undefined) {
      findings.push({
        rule: 'L7',
        file: 'package.json',
        message: 'exports["./client"] has no runtime target — add a "default" (or "import"/"require") string leaf',
      })
      return findings
    }

    const files = filesList(manifest)
    // The map is derived, not declared: the preset always writes `<bundle>.map` beside the bundle.
    for (const [pointer, path] of [
      ['exports["./client"]', normalize(target)],
      ['exports["./client"] source map', `${normalize(target)}.map`],
    ] as const) {
      if (files.some((pattern) => covers(pattern, path))) continue
      findings.push({
        rule: 'L7',
        file: 'package.json',
        message: `${pointer} points at ${path}, which no "files" entry covers — it would be absent from the `
          + 'installed package',
      })
    }

    return findings
  },
}

/**
 * The manifest rule table. Only some rules exist so far; the rest are written as plugins arrive:
 * L1 `dsh.bundle` ⟺ `cordis.patch.yml` exists and is listed in `exports`
 * L2 the `name` of every `insert` row in `cordis.patch.yml` == this package's name
 * L3 `files` covers `main` and `cordis.patch.yml`
 * L4 `@deepseek-ai/cordis` and `@deepseek-ai/dsh-*` appear as a peer + dev pair and never in dependencies
 * L5 every `@deepseek-ai/*` in `dependencies` is inside `DEPENDENCY_ALLOWLIST`
 * L6 the README has the three sections: install / configure / security
 */
export const rules: Rule[] = [l7ClientHalf]
