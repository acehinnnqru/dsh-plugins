import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath, sep } from 'node:path'
import { transform } from 'lightningcss'
import type { TsdownPlugin } from 'tsdown'

/**
 * The client bundle compiles its own CSS with lightningcss, because the bundle is fetched as a plain
 * `<script>` outside any bundler's asset pipeline: a stylesheet has to arrive as bytes inside
 * `client.js`, tagged so the host's hot reload can find and retract it.
 *
 * Three import forms, all resolved here:
 *
 * - `x.module.css` — a hashed class map as the default export, plus the compiled stylesheet injected
 *   as a tagged `<style>` when the factory runs.
 * - `x.css?inline` — the compiled stylesheet text as the default export. The consumer owns the tag
 *   and its lifecycle; nothing is injected.
 * - `x.css` — the compiled stylesheet injected as a tagged `<style>`, importing for the side effect.
 */
const MODULE_PREFIX = '\0dsh-css-modules:'
const GLOBAL_PREFIX = '\0dsh-css-global:'
const INLINE_PREFIX = '\0dsh-css-text:'

/**
 * The virtual id suffix. It must not read as a stylesheet: tsdown's own CSS guard matches ids ending
 * in `.css`, and letting it see these would route them into a pipeline this preset does not use.
 */
const VIRTUAL_SUFFIX = '.mjs'

/** The query that selects text instead of injection. */
const INLINE_QUERY = '?inline'

/** The id baked into `data-plugin`/`data-plugin-css`, and how the host tells two stylesheets apart. */
function styleTagId(pluginId: string, file: string): string {
  return `${pluginId}/${basename(file)}`
}

/**
 * The CSS Modules class-name pattern, upstream's: `[hash]_[local]` keeps the local name visible,
 * which is what makes a built bundle debuggable without turning the class list into a public API.
 */
const CLASS_NAME_PATTERN = '[hash]_[local]'

/**
 * Emit the module body that injects one stylesheet, optionally exporting its class map.
 *
 * The lookup before insertion keeps a second materialization of the same factory from adding a
 * duplicate tag. The `document` guard keeps the module importable where there is no DOM.
 * @param pluginId - package name, stamped onto the tag for the host to own the styles by.
 * @param file - absolute path of the stylesheet, used for the per-file tag id.
 * @param css - compiled stylesheet text.
 * @param classMap - CSS Modules local-to-hashed map, when the import form asked for one.
 * @returns the module source.
 */
function injectionModule(
  pluginId: string,
  file: string,
  css: string,
  classMap?: Readonly<Record<string, string>>,
): string {
  const tagId = styleTagId(pluginId, file)
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=\"' + tagId + '\"]') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

/** Compile one stylesheet with lightningcss, optionally collecting its CSS Modules class map. */
function compile(
  file: string,
  source: Uint8Array,
  cssModules: boolean,
): { code: string; classMap?: Record<string, string> } {
  // Always compile with `cssModules` on: lightningcss only returns the class map for its own pattern,
  // and the result object is not exposed in a way a spread can vary. A stylesheet that uses no
  // modules simply returns an empty map, which the callers below ignore.
  const result = transform({
    filename: file,
    code: source,
    minify: true,
    cssModules: { pattern: CLASS_NAME_PATTERN },
  })
  const code = result.code.toString()
  const classMap: Record<string, string> = {}
  const exports = 'exports' in result ? result.exports : undefined
  if (exports !== undefined) {
    for (const [local, mapping] of Object.entries(exports).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      classMap[local] = mapping.name
    }
  }
  return cssModules ? { code, classMap } : { code }
}

/**
 * Resolve an emitted import back to the source tree.
 *
 * The client build consumes `lib/types`, so a stylesheet sits next to the emitted `.js` under
 * `lib/types/...` while the real file lives under `src/...`. Prefer the real file when it is there,
 * and fall back to the emitted path so the error still names what was actually imported.
 * @param specifier - the raw import specifier.
 * @param importer - absolute path of the importing module.
 * @returns the absolute path to read, which may not exist.
 */
function sourceAssetPath(specifier: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), specifier)
  const marker = `${sep}lib${sep}types${sep}`
  const at = emitted.indexOf(marker)
  if (at < 0) return emitted
  const source = resolvePath(`${emitted.slice(0, at)}${sep}src${sep}`, emitted.slice(at + marker.length))
  return existsSync(source) ? source : emitted
}

/** Read one stylesheet, registering the physical file so a change reaches the watcher's graph. */
async function loadStylesheet(context: { addWatchFile: (id: string) => void }, file: string): Promise<Uint8Array> {
  context.addWatchFile(file)
  return await readFile(file)
}

/**
 * Build the three CSS plugins for one plugin id.
 * @param pluginId - package name, stamped onto every injected style tag.
 * @returns the plugins, in resolution order: modules, then `?inline`, then plain.
 */
export function cssPlugins(pluginId: string): TsdownPlugin[] {
  /** Route one import form to its virtual id, or `null` when this plugin does not own the specifier. */
  const route = (specifier: string, importer: string | undefined): string | null => {
    const own = (prefix: string, stylesheet: string): string =>
      prefix + (importer === undefined ? stylesheet : sourceAssetPath(stylesheet, importer)) + VIRTUAL_SUFFIX
    if (specifier.endsWith('.module.css')) return own(MODULE_PREFIX, specifier)
    if (specifier.endsWith(`.css${INLINE_QUERY}`)) {
      return own(INLINE_PREFIX, specifier.slice(0, -INLINE_QUERY.length))
    }
    if (specifier.endsWith('.css')) return own(GLOBAL_PREFIX, specifier)
    return null
  }

  /** The absolute path a virtual id wraps. */
  const fileOf = (id: string, prefix: string): string => id.slice(prefix.length, -VIRTUAL_SUFFIX.length)

  return [
    {
      name: 'dsh-css-modules',
      resolveId(source, importer) {
        const id = route(source, importer)
        return id?.startsWith(MODULE_PREFIX) === true ? id : null
      },
      async load(id) {
        if (!id.startsWith(MODULE_PREFIX)) return null
        const file = fileOf(id, MODULE_PREFIX)
        const { code, classMap } = compile(file, await loadStylesheet(this, file), true)
        return injectionModule(pluginId, file, code, classMap)
      },
    },
    {
      name: 'dsh-css-text',
      resolveId(source, importer) {
        const id = route(source, importer)
        return id?.startsWith(INLINE_PREFIX) === true ? id : null
      },
      async load(id) {
        if (!id.startsWith(INLINE_PREFIX)) return null
        const file = fileOf(id, INLINE_PREFIX)
        const { code } = compile(file, await loadStylesheet(this, file), false)
        return `export default ${JSON.stringify(code)};`
      },
    },
    {
      name: 'dsh-css-global',
      resolveId(source, importer) {
        const id = route(source, importer)
        return id?.startsWith(GLOBAL_PREFIX) === true ? id : null
      },
      async load(id) {
        if (!id.startsWith(GLOBAL_PREFIX)) return null
        const file = fileOf(id, GLOBAL_PREFIX)
        const { code } = compile(file, await loadStylesheet(this, file), false)
        return injectionModule(pluginId, file, code)
      },
    },
  ]
}
