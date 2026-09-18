import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkPack, type PackManifest } from '../src/index.ts'

/** The smallest patch the loader accepts: a top-level array with one named insert row. */
const PATCH = [
  '- insert:',
  '    - id: demo',
  '      name: dsh-plugin-demo',
  '      config:',
  "        timeZone: 'UTC'",
  '',
].join('\n')

const BASE_FILES = [
  'package.json',
  'lib/index.js',
  'lib/types/index.d.ts',
  'cordis.patch.yml',
  'README.md',
]

const CLIENT_FILES = [...BASE_FILES, 'lib/client.js', 'lib/client.js.map', 'lib/types/client/index.d.ts']

function baseManifest(): PackManifest {
  return {
    name: 'dsh-plugin-demo',
    version: '0.0.0',
    main: 'lib/index.js',
    types: 'lib/types/index.d.ts',
    exports: {
      '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json',
    },
    files: [...BASE_FILES],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }
}

function clientManifest(): PackManifest {
  const manifest = baseManifest()
  manifest.exports = {
    ...(manifest.exports as Record<string, unknown>),
    './client': { types: './lib/types/client/index.d.ts', default: './lib/client.js' },
  }
  manifest.dsh = { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } }
  return manifest
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pack-check-'))
  await writeFile(join(dir, 'cordis.patch.yml'), PATCH)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function check(manifest: PackManifest, files: readonly string[] = BASE_FILES) {
  return checkPack({ dir, manifest, files })
}

function rulesOf(findings: { rule: string }[]): string[] {
  return findings.map((finding) => finding.rule)
}

describe('checkPack', () => {
  it('passes a complete host-half plugin', () => {
    expect(check(baseManifest())).toEqual([])
  })

  it('passes a complete client plugin', () => {
    expect(check(clientManifest(), CLIENT_FILES)).toEqual([])
  })

  describe('P1 package identity', () => {
    it('reports a tarball without package.json', () => {
      const files = BASE_FILES.filter((file) => file !== 'package.json')
      // P3 sees it too: the './package.json' export now points at an unpacked file.
      expect(rulesOf(check(baseManifest(), files))).toEqual(['P1', 'P3'])
    })

    it('reports an empty name', () => {
      const manifest = baseManifest()
      manifest.name = ''
      // P5 sees it too: the patch's insert row no longer names this package.
      expect(rulesOf(check(manifest))).toEqual(['P1', 'P5'])
    })

    it('reports a missing version', () => {
      const manifest = baseManifest()
      delete manifest.version
      expect(rulesOf(check(manifest))).toEqual(['P1'])
    })
  })

  describe('P2 main and types', () => {
    it('reports a main that was never built', () => {
      const manifest = baseManifest()
      manifest.main = 'lib/missing.js'
      const findings = check(manifest)
      expect(rulesOf(findings)).toEqual(['P2'])
      expect(findings[0]?.message).toContain('lib/missing.js is missing from disk — run pnpm build first')
    })

    it('reports a main that is on disk but not in the tarball', async () => {
      await mkdir(join(dir, 'lib'), { recursive: true })
      await writeFile(join(dir, 'lib', 'other.js'), '// built but unpacked\n')
      const manifest = baseManifest()
      manifest.main = 'lib/other.js'
      const findings = check(manifest)
      expect(rulesOf(findings)).toEqual(['P2'])
      expect(findings[0]?.message).toContain('lib/other.js is on disk but not in the tarball — files or its glob is wrong')
    })

    it('reports types that are not in the tarball', () => {
      const manifest = baseManifest()
      manifest.types = 'lib/types/other.d.ts'
      expect(rulesOf(check(manifest))).toEqual(['P2'])
    })
  })

  describe('P3 exports subpaths', () => {
    it('reports a subpath whose file is not packed', () => {
      const manifest = baseManifest()
      manifest.exports = {
        ...(manifest.exports as Record<string, unknown>),
        './extra': './lib/extra.js',
      }
      expect(rulesOf(check(manifest))).toEqual(['P3'])
    })

    it('reports a nested string leaf that is not packed', () => {
      const manifest = baseManifest()
      manifest.exports = {
        ...(manifest.exports as Record<string, unknown>),
        './extra': { types: './lib/extra.d.ts' },
      }
      expect(rulesOf(check(manifest))).toEqual(['P3'])
    })
  })

  describe('P4 bundle layer', () => {
    it('reports a missing dsh.bundle.patch', () => {
      const manifest = baseManifest()
      delete manifest.dsh
      expect(rulesOf(check(manifest))).toEqual(['P4'])
    })

    it('reports a patch file that is not in the tarball', () => {
      const files = BASE_FILES.filter((file) => file !== 'cordis.patch.yml')
      // P3 sees it too: the './cordis.patch.yml' export points at an unpacked file.
      expect(rulesOf(check(baseManifest(), files))).toEqual(['P3', 'P4'])
    })

    it('reports a patch with no exports subpath pointing at it', () => {
      const manifest = baseManifest()
      delete (manifest.exports as Record<string, unknown>)['./cordis.patch.yml']
      const findings = check(manifest)
      expect(rulesOf(findings)).toEqual(['P4'])
      expect(findings[0]?.message).toContain('no exports subpath points at cordis.patch.yml')
    })

    it('reports a patch path that escapes the package', () => {
      const manifest = baseManifest()
      manifest.dsh = { bundle: { patch: '../outside.yml' } }
      expect(rulesOf(check(manifest))).toEqual(['P4'])
    })
  })

  describe('P5 patch contents', () => {
    it('reports a patch that is not a top-level array', async () => {
      await writeFile(join(dir, 'cordis.patch.yml'), 'id: demo\n')
      const findings = check(baseManifest())
      expect(rulesOf(findings)).toEqual(['P5'])
      expect(findings[0]?.message).toContain('top-level YAML array')
    })

    it('reports an insert row naming another package', async () => {
      await writeFile(
        join(dir, 'cordis.patch.yml'),
        '- insert:\n    - id: demo\n      name: other-package\n',
      )
      const findings = check(baseManifest())
      expect(rulesOf(findings)).toEqual(['P5'])
      expect(findings[0]?.message).toContain('declares name "other-package"')
    })

    it('reports a patch that is not valid YAML', async () => {
      await writeFile(join(dir, 'cordis.patch.yml'), '- insert: [\n')
      expect(rulesOf(check(baseManifest()))).toEqual(['P5'])
    })

    it('accepts the !!js dialect the loader mounts', async () => {
      await writeFile(
        join(dir, 'cordis.patch.yml'),
        '- insert:\n    - id: demo\n      name: dsh-plugin-demo\n      config:\n        at: !!js process.cwd()\n',
      )
      expect(check(baseManifest())).toEqual([])
    })
  })

  describe('P6 client half', () => {
    it('reports dsh.client with no exports["./client"]', () => {
      const manifest = clientManifest()
      delete (manifest.exports as Record<string, unknown>)['./client']
      const findings = check(manifest, CLIENT_FILES)
      expect(rulesOf(findings)).toEqual(['P6'])
      expect(findings[0]?.message).toContain('exports has no "./client" subpath')
    })

    it('reports exports["./client"] with no dsh.client', () => {
      const manifest = baseManifest()
      manifest.exports = {
        ...(manifest.exports as Record<string, unknown>),
        './client': { types: './lib/types/client/index.d.ts', default: './lib/client.js' },
      }
      const findings = check(manifest, CLIENT_FILES)
      expect(rulesOf(findings)).toEqual(['P6'])
      expect(findings[0]?.message).toContain('dsh.client is not declared')
    })

    it('reports a platform that is not web', () => {
      const manifest = clientManifest()
      manifest.dsh = { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'node' } }
      const findings = check(manifest, CLIENT_FILES)
      expect(rulesOf(findings)).toEqual(['P6'])
      expect(findings[0]?.message).toContain("platform must be 'web'")
    })

    it('reports a client bundle missing from the tarball', () => {
      const files = CLIENT_FILES.filter((file) => file !== 'lib/client.js')
      // P3 sees the exports leaf and P6 sees the runtime target: two rules, one cause, on purpose.
      expect(rulesOf(check(clientManifest(), files))).toEqual(['P3', 'P6'])
    })

    it('reports a client bundle without its source map', () => {
      const files = CLIENT_FILES.filter((file) => file !== 'lib/client.js.map')
      const findings = check(clientManifest(), files)
      expect(rulesOf(findings)).toEqual(['P6'])
      expect(findings[0]?.message).toContain('lib/client.js.map is missing from disk — run pnpm build first')
    })
  })

  describe('P7 publishConfig', () => {
    it('reports a publishConfig that rewrites a checked field', () => {
      const manifest = baseManifest()
      manifest.publishConfig = { main: 'lib/other.js' }
      const findings = check(manifest)
      expect(rulesOf(findings)).toEqual(['P7'])
      expect(findings[0]?.message).toContain('publishConfig rewrites main')
    })
  })
})
