import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath, sep } from 'node:path'
import type { TsdownPlugin } from 'tsdown'

/**
 * Chain the maps `tsc` already emitted into the client bundle's own map.
 *
 * The client build consumes `lib/types`, and each emitted `.js` there carries a `.js.map` pointing at
 * the real `.ts` beside it. Left alone, the bundle's map would name `lib/types/...` — files a plugin
 * does not ship and a browser cannot fetch — so profiling would land on generated code. This plugin
 * hands rolldown the original source text and the map that gets back to it, which is what puts real
 * `.ts`/`.tsx` paths and `sourcesContent` into `client.js.map`.
 *
 * @module dsh-client-preset/sourcemap
 */

/** The path segment separating a package's emitted types from the sources they came from. */
const TYPES_MARKER = `${sep}lib${sep}types${sep}`

/** The map `tsc` writes next to each emitted module. */
const TSC_MAP_SUFFIX = '.map'

/** The subset of a `tsc` map this plugin reads. */
interface TscMap {
  sourceRoot?: unknown
  sources?: unknown
  sourcesContent?: unknown
  [key: string]: unknown
}

/**
 * Read one emitted module and the map that gets back to its source, filling in `sourcesContent` from
 * disk when `tsc` did not inline it.
 * @param id - the module being loaded.
 * @returns the source plus its map, or `null` when this module has no chained map.
 */
async function chain(id: string): Promise<{ code: string; map: TscMap } | null> {
  if (!id.includes(TYPES_MARKER) || !id.endsWith('.js')) return null
  const mapPath = `${id}${TSC_MAP_SUFFIX}`
  if (!existsSync(mapPath)) return null
  const map = JSON.parse(await readFile(mapPath, 'utf8')) as TscMap
  if (!Array.isArray(map.sources) || map.sources.some((source) => typeof source !== 'string')) {
    throw new Error(`dsh-client-preset: ${mapPath} has an invalid sources list`)
  }
  const sources = map.sources as string[]
  const contents = map.sourcesContent
  const complete = Array.isArray(contents)
    && contents.length === sources.length
    && contents.every((source) => typeof source === 'string')
  if (!complete) {
    const sourceRoot = typeof map.sourceRoot === 'string' ? map.sourceRoot : ''
    map.sourcesContent = await Promise.all(
      sources.map(async (source) => await readFile(resolvePath(dirname(mapPath), sourceRoot, source), 'utf8')),
    )
  }
  return { code: await readFile(id, 'utf8'), map }
}

/**
 * Build the plugin that chains `tsc`'s maps into the client bundle's map.
 * @returns the plugin.
 */
export function tscSourceMapPlugin(): TsdownPlugin {
  return {
    name: 'dsh-tsc-sourcemap',
    async load(id) {
      const chained = await chain(id)
      if (chained === null) return null
      this.addWatchFile(id)
      this.addWatchFile(`${id}${TSC_MAP_SUFFIX}`)
      // A module this hook fills in is not one rolldown read from disk, so rolldown does not put it in
      // the watch graph — and in watch mode the bundle would then never rebuild when `tsc -b --watch`
      // rewrites the emitted file. Declaring the inputs is what makes the loop close. The source map
      // is watched too: `tsc` rewrites it in the same step, and the map is half of what is returned.
      return { code: chained.code, map: chained.map as never }
    },
  }
}
