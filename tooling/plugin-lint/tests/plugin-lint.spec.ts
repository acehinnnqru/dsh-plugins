import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lintPlugin } from '../src/index.ts'

/** The fields L7 reads, and nothing else — the rule must not need a complete manifest to decide. */
interface Manifest {
  exports?: unknown
  files?: unknown
  dsh?: unknown
}

/** A complete browser-half manifest; every case below bends it in exactly one place. */
const CLIENT_HALF: Manifest = {
  exports: {
    '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
    './client': { types: './lib/types/client/index.d.ts', default: './lib/client.js' },
  },
  files: ['lib/index.js', 'lib/client.js', 'lib/client.js.map', 'lib/types/**/*.d.ts'],
  dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
}

describe('L7 — the browser half ships what the host reads', () => {
  let dir: string

  /** Write one manifest into the temp plugin directory, replacing whatever the last case wrote. */
  async function manifest(value: unknown): Promise<void> {
    await writeFile(join(dir, 'package.json'), JSON.stringify(value, null, 2))
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'plugin-lint-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('passes a complete browser-half manifest, and stays silent for a host-only one', async () => {
    await manifest(CLIENT_HALF)
    expect(await lintPlugin(dir)).toEqual([])

    await manifest({ exports: { '.': './lib/index.js' }, files: ['lib/index.js'] })
    expect(await lintPlugin(dir)).toEqual([])
  })

  it('reports dsh.client with no exports["./client"]', async () => {
    await manifest({ ...CLIENT_HALF, exports: { '.': './lib/index.js' } })
    const [finding, ...rest] = await lintPlugin(dir)
    expect(rest).toEqual([])
    expect(finding?.rule).toBe('L7')
    expect(finding?.message).toContain('exports has no "./client" subpath')
  })

  it('reports exports["./client"] with no dsh.client', async () => {
    await manifest({ ...CLIENT_HALF, dsh: { bundle: { patch: './cordis.patch.yml' } } })
    const [finding, ...rest] = await lintPlugin(dir)
    expect(rest).toEqual([])
    expect(finding?.rule).toBe('L7')
    expect(finding?.message).toContain('dsh.client is not declared')
  })

  it('reports a platform that is not web', async () => {
    await manifest({ ...CLIENT_HALF, dsh: { client: { platform: 'node' } } })
    const findings = await lintPlugin(dir)
    expect(findings.map((finding) => finding.message).join('\n')).toContain("platform must be 'web'")
  })

  it('reports a bundle that files does not cover', async () => {
    await manifest({ ...CLIENT_HALF, files: ['lib/index.js', 'lib/types/**/*.d.ts'] })
    const findings = await lintPlugin(dir)
    const messages = findings.map((finding) => finding.message)
    // Both the bundle and its derived map drop out together, and each says which one it is.
    expect(messages).toHaveLength(2)
    expect(messages.join('\n')).toContain('exports["./client"] points at lib/client.js')
    expect(messages.join('\n')).toContain('source map')
  })

  it('reports a source map that files does not cover', async () => {
    await manifest({ ...CLIENT_HALF, files: ['lib/index.js', 'lib/client.js'] })
    const [finding, ...rest] = await lintPlugin(dir)
    expect(rest).toEqual([])
    expect(finding?.message).toContain('source map')
    expect(finding?.message).toContain('lib/client.js.map')
  })

  it('accepts a glob that reaches the bundle', async () => {
    await manifest({ ...CLIENT_HALF, files: ['lib/*.js', 'lib/*.js.map'] })
    expect(await lintPlugin(dir)).toEqual([])
  })

  it('does not let a single-star glob cross a directory', async () => {
    await manifest({ ...CLIENT_HALF, files: ['lib/index.js', 'lib/*.js'] })
    const findings = await lintPlugin(dir)
    expect(findings.map((finding) => finding.message).join('\n')).toContain('lib/client.js.map')
  })

  it('reports an exports leaf with no runtime target', async () => {
    await manifest({ ...CLIENT_HALF, exports: { './client': { types: './lib/types/client/index.d.ts' } } })
    const [finding, ...rest] = await lintPlugin(dir)
    expect(rest).toEqual([])
    expect(finding?.message).toContain('no runtime target')
  })

  it('reports nothing for a directory that has no manifest at all', async () => {
    expect(await lintPlugin(dir)).toEqual([])
  })
})
