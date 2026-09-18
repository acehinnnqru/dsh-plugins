/**
 * Scaffold a plugin from `templates/plugin`.
 *
 * Rendering and writing are two calls on purpose: the smoke test renders a plugin into a temporary
 * directory and builds it there, so template rot is caught without touching this repo.
 * @module new-plugin
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

/** One file to write; `path` is relative to the plugin directory, with POSIX separators. */
export interface RenderedFile {
  /** Where the file lands inside the plugin directory. */
  path: string
  /** The file body, placeholders already substituted. */
  contents: string
}

/** What to generate. */
export interface PluginOptions {
  /** Repository root: `templates/plugin` is read from here. */
  root: string
  /** Where the plugin is written; defaults to `<root>/plugins/<name>`. */
  dir?: string
  /** Plugin name without the `dsh-plugin-` prefix, as returned by {@link normalizeName}. */
  name: string
  /** Also generate the browser half. */
  ui?: boolean
  /** Substituted for `__DSH_VERSION__`; pass `DSH_VERSION` from `tooling/dsh-compat`. */
  dshVersion: string
}

const TEMPLATE_DIR = join('templates', 'plugin')
const PACKAGE_PREFIX = 'dsh-plugin-'
/** npm-legal and prefix-free: a letter, then letters/digits/hyphens, never ending in a hyphen. */
const NAME_PATTERN = /^[a-z](?:[a-z0-9-]*[a-z0-9])?$/

/**
 * Accept `foo` and `dsh-plugin-foo` as the same plugin; reject anything that cannot become a package name.
 * @param input - the raw CLI argument.
 * @returns the bare plugin name.
 */
export function normalizeName(input: string): string {
  const name = input.startsWith(PACKAGE_PREFIX) ? input.slice(PACKAGE_PREFIX.length) : input
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `invalid plugin name ${JSON.stringify(input)}: use lowercase letters, digits and hyphens, starting with a letter`,
    )
  }
  return name
}

/**
 * @param name - bare plugin name.
 * @returns the package name, `dsh-plugin-<name>`.
 */
export function packageName(name: string): string {
  return PACKAGE_PREFIX + name
}

/** Every file under `dir`, sorted, so rendering is deterministic. */
async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) paths.push(...await walk(path))
    else paths.push(path)
  }
  return paths.sort()
}

/**
 * Where one template file lands, or `undefined` when this variant does not ship it.
 * @param path - template-relative POSIX path.
 * @param ui - whether the browser half is being generated.
 * @returns the plugin-relative path, or undefined.
 */
function targetPath(path: string, ui: boolean): string | undefined {
  if (path === 'tsdown.config.ts.tpl') return ui ? undefined : 'tsdown.config.ts'
  if (path === 'tsdown.config.ui.ts.tpl') return ui ? 'tsdown.config.ts' : undefined
  if (path === 'src/client/index.tsx.tpl') return ui ? 'src/client/index.tsx' : undefined
  return path.endsWith('.tpl') ? path.slice(0, -'.tpl'.length) : path
}

/**
 * The browser half adds five devDependencies the host half does not need.
 *
 * `dsh-client-preset` has to be `file:`, not `workspace:*`: pnpm cannot resolve a workspace protocol
 * when packing, and `verify:pack` packs every plugin (0005, implementation note 3).
 * @param dshVersion - the pinned DSH version.
 * @returns the extra devDependencies.
 */
function uiDevDependencies(dshVersion: string): Record<string, string> {
  return {
    '@deepseek-ai/dsh-client-ui-renderer': dshVersion,
    '@deepseek-ai/dsh-client-ui-sidebar': dshVersion,
    '@deepseek-ai/dsh-client-ui-slots': dshVersion,
    '@types/react': '18.3.31',
    'dsh-client-preset': 'file:../../tooling/dsh-client-preset',
  }
}

/**
 * Add the three manifest pieces the browser half needs.
 * @param raw - the rendered host manifest.
 * @param dshVersion - the pinned DSH version.
 * @returns the manifest text.
 */
function applyUiManifest(raw: string, dshVersion: string): string {
  const manifest = JSON.parse(raw) as {
    exports: Record<string, unknown>
    files: string[]
    dsh: Record<string, unknown>
    devDependencies: Record<string, string>
  }

  const { '.': hostEntry, ...rest } = manifest.exports
  manifest.exports = {
    '.': hostEntry,
    './client': { types: './lib/types/client/index.d.ts', default: './lib/client.js' },
    ...rest,
  }

  const at = manifest.files.indexOf('lib/index.js')
  manifest.files = [
    ...manifest.files.slice(0, at + 1),
    'lib/client.js',
    'lib/client.js.map',
    ...manifest.files.slice(at + 1),
  ]

  manifest.dsh = { ...manifest.dsh, client: { platform: 'web' } }
  manifest.devDependencies = Object.fromEntries(
    Object.entries({ ...manifest.devDependencies, ...uiDevDependencies(dshVersion) })
      .sort(([a], [b]) => a.localeCompare(b)),
  )

  return JSON.stringify(manifest, null, 2) + '\n'
}

/**
 * Add the DOM and JSX options the browser half compiles under.
 * @param raw - the rendered host tsconfig.
 * @returns the tsconfig text.
 */
function applyUiTsconfig(raw: string): string {
  const tsconfig = JSON.parse(raw) as { compilerOptions: Record<string, unknown> }
  tsconfig.compilerOptions = {
    ...tsconfig.compilerOptions,
    lib: ['ES2024', 'DOM', 'DOM.Iterable'],
    jsx: 'react-jsx',
  }
  return JSON.stringify(tsconfig, null, 2) + '\n'
}

/**
 * Render every file of the new plugin, in memory.
 * @param options - what to generate.
 * @returns the files, sorted by path.
 */
export async function renderPlugin(options: PluginOptions): Promise<RenderedFile[]> {
  const ui = options.ui ?? false
  const dir = join(options.root, TEMPLATE_DIR)
  const files: RenderedFile[] = []

  for (const absolute of await walk(dir)) {
    const templatePath = relative(dir, absolute).split(sep).join('/')
    const target = targetPath(templatePath, ui)
    if (target === undefined) continue

    const raw = await readFile(absolute, 'utf8')
    let contents = raw
      .replaceAll('__PACKAGE__', packageName(options.name))
      .replaceAll('__NAME__', options.name)
      .replaceAll('__DSH_VERSION__', options.dshVersion)

    if (target === 'package.json' && ui) contents = applyUiManifest(contents, options.dshVersion)
    if (target === 'tsconfig.json' && ui) contents = applyUiTsconfig(contents)

    files.push({ path: target, contents })
  }

  return files
}

/**
 * Render the plugin and write it to `<root>/plugins/<name>`.
 * @param options - what to generate.
 * @returns the written paths, relative to the plugin directory.
 */
export async function writePlugin(options: PluginOptions): Promise<string[]> {
  const dir = options.dir ?? join(options.root, 'plugins', options.name)
  const written: string[] = []

  for (const file of await renderPlugin(options)) {
    const target = join(dir, ...file.path.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.contents)
    written.push(file.path)
  }

  return written.sort()
}

/**
 * Add `./plugins/<name>` to the root tsconfig's `references`. Idempotent.
 *
 * Without the reference `pnpm typecheck` never sees the plugin; with a dangling one it fails outright
 * (`TS5083`), which is why deleting a generated plugin also means deleting its reference.
 * @param root - repository root.
 * @param name - bare plugin name.
 * @returns whether the tsconfig changed.
 */
export function addPluginReference(root: string, name: string): boolean {
  const path = join(root, 'tsconfig.json')
  const text = readFileSync(path, 'utf8')
  const tsconfig = JSON.parse(text) as { references: { path: string }[] }
  const reference = `./plugins/${name}`
  if (tsconfig.references.some((entry) => entry.path === reference)) return false

  // Inserted as a line, never re-serialized: `JSON.stringify` expands every reference object in the
  // file, so adding one plugin would show up as a whole-file diff.
  const lines = text.split('\n')
  const anchors = [
    lines.findLastIndex((line) => line.includes('"path": "./plugins/')),
    lines.findIndex((line) => line.includes('"path": "./tsconfig.scripts.json"')),
    lines.findIndex((line) => line.trim() === '"references": ['),
  ]
  const anchor = anchors.find((index) => index !== -1)
  if (anchor === undefined) throw new Error(`no reference to insert after in ${path} — add ${reference} by hand`)

  const indent = /^\s*/.exec(lines[anchor] ?? '')?.[0] ?? '    '
  lines.splice(anchor + 1, 0, `${indent}{ "path": "${reference}" },`)

  writeFileSync(path, lines.join('\n'))
  return true
}
