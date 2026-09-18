import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, posix } from 'node:path'
import { parseEntryList } from './patch.ts'

/** One packaging violation. `file` is a path relative to the package directory. */
export interface Finding {
  /** Rule id, `P1`–`P7`. */
  rule: string
  file: string
  message: string
}

/**
 * The parts of a plugin manifest this check reads. Every value stays `unknown` on purpose: this is raw
 * parsed JSON, and a wrong type in the manifest has to become a finding, not a type assertion.
 */
export interface PackManifest {
  name?: unknown
  version?: unknown
  main?: unknown
  types?: unknown
  exports?: unknown
  files?: unknown
  dsh?: unknown
  publishConfig?: unknown
}

export interface PackInput {
  /** Plugin directory; used only to tell "on disk but unpacked" from "never built". */
  dir: string
  /** The source package.json, already JSON.parse'd. */
  manifest: PackManifest
  /** `pnpm pack --dry-run --json` → `files[].path`: package-relative, POSIX separators. */
  files: readonly string[]
}

const MANIFEST = 'package.json'
/** Manifest fields whose `publishConfig` rewrite would invalidate reading the source manifest. */
const PUBLISH_OVERRIDES = ['main', 'types', 'exports', 'files', 'dsh'] as const

/**
 * Check one plugin's tarball manifest against P1–P7.
 *
 * Everything is asserted against the tarball listing, never against the `files` globs: a missing entry,
 * a wrong glob and a product that was never built all look the same from here — "this path is not in
 * the tarball" — and the listing is the reality the profile installs.
 */
export function checkPack(input: PackInput): Finding[] {
  const { dir, manifest } = input
  const tarball = new Set(input.files.map(normalize))
  const findings: Finding[] = []

  // P1 — the package has to be installable at all.
  if (!tarball.has(MANIFEST)) {
    findings.push({ rule: 'P1', file: MANIFEST, message: `${MANIFEST} is not in the tarball — nothing can install a package without it` })
  }
  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    findings.push({ rule: 'P1', file: MANIFEST, message: 'name is missing or empty — the profile cannot reference the package' })
  }
  if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
    findings.push({ rule: 'P1', file: MANIFEST, message: 'version is missing or empty — the profile cannot reference a version of it' })
  }

  // P2 — the host entry points must survive packing.
  for (const key of ['main', 'types'] as const) {
    const value = manifest[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.trim() === '') {
      findings.push({ rule: 'P2', file: MANIFEST, message: `${key} must be a non-empty string` })
      continue
    }
    const missing = missingFromTarball('P2', key, value, dir, tarball)
    if (missing !== undefined) findings.push(missing)
  }

  // P3 — every string leaf of `exports`, so subpaths like `./client` are covered too.
  for (const { subpath, value } of exportLeaves(manifest.exports)) {
    const missing = missingFromTarball('P3', `exports[${JSON.stringify(subpath)}]`, value, dir, tarball)
    if (missing !== undefined) findings.push(missing)
  }

  // P4 — the config layer is only reachable if both the declaration and the exports subpath resolve.
  const patch = bundlePatch(manifest)
  if (patch === undefined) {
    findings.push({
      rule: 'P4',
      file: MANIFEST,
      message: 'dsh.bundle.patch is missing or empty — the package installs as an ordinary dependency and activates no config layer',
    })
  } else {
    const target = normalize(patch)
    if (isAbsolute(patch) || target === '..' || target.startsWith('../')) {
      findings.push({ rule: 'P4', file: MANIFEST, message: `dsh.bundle.patch must be a path inside the package, got ${patch}` })
    } else {
      const missing = missingFromTarball('P4', 'dsh.bundle.patch', patch, dir, tarball)
      if (missing !== undefined) findings.push(missing)
      const exported = exportLeaves(manifest.exports).some(
        (leaf) => leaf.subpath !== '.' && normalize(leaf.value) === target,
      )
      if (!exported) {
        findings.push({
          rule: 'P4',
          file: MANIFEST,
          message: `no exports subpath points at ${target} — the host reaches the layer through the package exports map`,
        })
      }
    }
  }

  // P5 — the patch file itself, parsed with the loader's own dialect.
  findings.push(...checkPatch(manifest, dir, patch))

  // P6 — the client half, when there is one.
  findings.push(...checkClient(manifest, dir, tarball))

  // P7 — `publishConfig` would rewrite the very fields read above; the conclusion would not hold.
  const publishConfig = manifest.publishConfig
  if (isRecord(publishConfig)) {
    const rewritten = PUBLISH_OVERRIDES.filter((key) => key in publishConfig)
    if (rewritten.length > 0) {
      findings.push({
        rule: 'P7',
        file: MANIFEST,
        message: `publishConfig rewrites ${rewritten.join(', ')} — this check reads the source manifest, so it cannot conclude anything about the packed one`,
      })
    }
  }

  return findings
}

/** P5: top-level array, and every `insert` row that carries a `name` must carry this package's name. */
function checkPatch(manifest: PackManifest, dir: string, patch: string | undefined): Finding[] {
  if (patch === undefined) return []
  const target = normalize(patch)
  if (isAbsolute(patch) || target === '..' || target.startsWith('../')) return []

  const path = join(dir, target)
  // Not on disk: P4 already said so, and there is nothing to parse.
  if (!existsSync(path)) return []

  let parsed: unknown
  try {
    parsed = parseEntryList(readFileSync(path, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return [{ rule: 'P5', file: target, message: `${target} is not valid YAML for the loader's dialect: ${detail}` }]
  }

  if (!Array.isArray(parsed)) {
    return [{
      rule: 'P5',
      file: target,
      message: `${target} must be a top-level YAML array of patch entries, got ${parsed === null ? 'null' : typeof parsed}`,
    }]
  }

  const findings: Finding[] = []
  parsed.forEach((row, index) => {
    if (!isRecord(row)) {
      findings.push({ rule: 'P5', file: target, message: `patch entry ${index + 1} is not a mapping` })
      return
    }
    const insert = row['insert']
    if (insert === undefined) return
    if (!Array.isArray(insert)) {
      findings.push({ rule: 'P5', file: target, message: `insert on patch entry ${index + 1} must be a list` })
      return
    }
    insert.forEach((entry, at) => {
      if (!isRecord(entry) || !('name' in entry)) return
      if (entry['name'] === manifest.name) return
      const id = typeof entry['id'] === 'string' ? ` (id ${entry['id']})` : ''
      findings.push({
        rule: 'P5',
        file: target,
        message: `insert row ${at + 1}${id} declares name ${JSON.stringify(entry['name'])}, but this package is ${JSON.stringify(manifest.name)} — the loader would import a module that is not this package`,
      })
    })
  })
  return findings
}

/** P6: `dsh.client` ⟺ `exports["./client"]`, and a declared half has to ship its bundle and its map. */
function checkClient(manifest: PackManifest, dir: string, tarball: Set<string>): Finding[] {
  const dsh = manifest.dsh
  const client = isRecord(dsh) ? dsh['client'] : undefined
  const declared = client !== undefined && client !== null
  const entry = isRecord(manifest.exports) ? manifest.exports['./client'] : undefined
  const findings: Finding[] = []

  if (declared && entry === undefined) {
    findings.push({
      rule: 'P6',
      file: MANIFEST,
      message: 'dsh.client is declared but exports has no "./client" subpath — the host fails when it tries to load it',
    })
  }
  if (!declared && entry !== undefined) {
    findings.push({
      rule: 'P6',
      file: MANIFEST,
      message: 'exports["./client"] exists but dsh.client is not declared — nothing ever loads this bundle',
    })
  }
  if (!declared) return findings

  if (!isRecord(client) || client['platform'] !== 'web') {
    const actual = isRecord(client) ? JSON.stringify(client['platform']) : JSON.stringify(client)
    findings.push({ rule: 'P6', file: MANIFEST, message: `dsh.client.platform must be 'web', got ${actual}` })
  }

  if (entry !== undefined) {
    const target = runtimeTarget(entry)
    if (target === undefined) {
      findings.push({
        rule: 'P6',
        file: MANIFEST,
        message: 'exports["./client"] has no runtime target — add a "default" (or "import"/"require") string leaf',
      })
    } else {
      const missing = missingFromTarball('P6', 'exports["./client"]', target, dir, tarball)
      if (missing !== undefined) findings.push(missing)
      // The browser devtools and the HMR driver both key off the bundle's source map.
      const map = missingFromTarball('P6', 'exports["./client"] source map', `${normalize(target)}.map`, dir, tarball)
      if (map !== undefined) findings.push(map)
    }
  }

  return findings
}

/** `./lib/index.js` → `lib/index.js`; the manifest and the tarball listing are compared in this form. */
function normalize(path: string): string {
  return posix.normalize(path.replace(/^\.\//, '')).replace(/\/+$/, '')
}

function missingFromTarball(
  rule: string,
  pointer: string,
  path: string,
  dir: string,
  tarball: Set<string>,
): Finding | undefined {
  const target = normalize(path)
  if (tarball.has(target)) return undefined
  // The two causes need two sentences: a silently empty tarball (a deleted `lib/`) otherwise reads
  // exactly like a wrong `files` glob. Measured: `rm -rf lib` then pack exits 0 with no warning.
  const reason = isFile(dir, target)
    ? `${target} is on disk but not in the tarball — files or its glob is wrong`
    : `${target} is missing from disk — run pnpm build first`
  return { rule, file: MANIFEST, message: `${pointer}: ${reason}` }
}

function isFile(dir: string, target: string): boolean {
  try {
    return statSync(join(dir, target)).isFile()
  } catch {
    return false
  }
}

/** Every string reachable from the `exports` map as `{ subpath, value }`, objects flattened. */
function exportLeaves(exports: unknown): { subpath: string; value: string }[] {
  if (typeof exports === 'string') return [{ subpath: '.', value: exports }]
  if (!isRecord(exports)) return []
  return Object.entries(exports).flatMap(([subpath, value]) =>
    stringLeaves(value).map((leaf) => ({ subpath, value: leaf })),
  )
}

function stringLeaves(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  if (Array.isArray(node)) return node.flatMap((entry) => stringLeaves(entry))
  if (isRecord(node)) return Object.values(node).flatMap((entry) => stringLeaves(entry))
  return []
}

/** The file the host's `import()` ends up loading: the `default` condition when there is one. */
function runtimeTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return undefined
  for (const condition of ['default', 'import', 'require', 'browser', 'node'] as const) {
    const resolved = runtimeTarget(value[condition])
    if (resolved !== undefined) return resolved
  }
  return undefined
}

/** `dsh.bundle.patch`, when it is a usable non-empty string. */
function bundlePatch(manifest: PackManifest): string | undefined {
  const dsh = manifest.dsh
  if (!isRecord(dsh)) return undefined
  const bundle = dsh['bundle']
  if (!isRecord(bundle)) return undefined
  const patch = bundle['patch']
  if (typeof patch !== 'string' || patch.trim() === '') return undefined
  return patch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
