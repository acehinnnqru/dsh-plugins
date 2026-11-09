import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import {
  buildMarketIndex,
  inferDshRange,
  normalizeRepositoryUrl,
  readMarketIndex,
  verifyMarketIndex,
} from '../src/index.ts'

/** A fixed committer time, so publishTimestamp is assertable. */
const DATE = '2026-01-02T03:04:05Z'
const TIMESTAMP = Math.floor(Date.parse(DATE) / 1000)
const REPO = 'https://github.com/acme/dsh-plugins'

let dir: string

function git(args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).trim()
}

async function write(relative: string, contents: string): Promise<void> {
  const path = join(dir, relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
}

async function manifest(relative: string, value: unknown): Promise<void> {
  await write(relative, JSON.stringify(value, null, 2) + '\n')
}

function plugin(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    version: '1.2.3',
    description: name + ' fixture',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    peerDependencies: { '@deepseek-ai/cordis': '4.1.0', '@deepseek-ai/dsh-tools': '0.2.2-rc.1' },
    ...overrides,
  }
}

async function commitAll(): Promise<string> {
  git(['add', '.'])
  const tree = git(['write-tree'])
  const commit = git(['commit-tree', tree, '-m', 'fixture'], {
    GIT_AUTHOR_DATE: DATE,
    GIT_COMMITTER_DATE: DATE,
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.com',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.com',
  })
  git(['update-ref', 'refs/heads/main', commit])
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'])
  return commit
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'market-index-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  git(['config', 'user.name', 'fixture'])
  git(['config', 'user.email', 'fixture@example.com'])
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('normalizeRepositoryUrl', () => {
  it('accepts the forms a Git remote actually uses', () => {
    expect(normalizeRepositoryUrl('git@github.com:acme/dsh-plugins.git')).toBe(REPO)
    expect(normalizeRepositoryUrl('https://github.com/acme/dsh-plugins.git')).toBe(REPO)
    expect(normalizeRepositoryUrl('ssh://git@github.com/acme/dsh-plugins.git')).toBe(REPO)
    expect(normalizeRepositoryUrl('github:acme/dsh-plugins')).toBe(REPO)
  })

  it('refuses what the market format refuses', () => {
    expect(() => normalizeRepositoryUrl('http://github.com/acme/dsh-plugins')).toThrow('https or ssh')
    expect(() => normalizeRepositoryUrl('git@github.com:dsh-plugins.git')).toThrow('owner/repo')
    expect(() => normalizeRepositoryUrl('https://user:pass@github.com/acme/dsh-plugins')).toThrow('credentials')
  })
})

describe('inferDshRange', () => {
  it('prefers an explicit engines.dsh', () => {
    expect(inferDshRange({ engines: { dsh: '>=0.2.0 <0.3.0' }, peerDependencies: { '@deepseek-ai/dsh-tools': '1.0.0' } }))
      .toBe('>=0.2.0 <0.3.0')
  })

  it('uses the one DSH peer range', () => {
    expect(inferDshRange(plugin('dsh-plugin-demo'))).toBe('0.2.2-rc.1')
  })

  it('refuses several different peer ranges', () => {
    expect(() => inferDshRange({
      peerDependencies: {
        '@deepseek-ai/dsh-tools': '0.2.2-rc.1',
        '@deepseek-ai/dsh-shell': '0.2.1-rc.1',
      },
    })).toThrow('declare engines.dsh')
  })

  it('refuses a manifest with no DSH requirement at all', () => {
    expect(() => inferDshRange({ peerDependencies: { '@deepseek-ai/cordis': '4.1.0' } })).toThrow('no engines.dsh')
  })
})

describe('buildMarketIndex', () => {
  it('lists each eligible plugin at the pinned commit', async () => {
    await manifest('plugins/alpha/package.json', plugin('dsh-plugin-alpha'))
    await write('plugins/alpha/cordis.patch.yml', '- insert:\n    - id: alpha\n      name: dsh-plugin-alpha\n')
    await manifest('plugins/beta/package.json', plugin('dsh-plugin-beta', { private: true }))
    await manifest('plugins/gamma/package.json', plugin('dsh-plugin-gamma', { engines: { dsh: '>=0.2.0 <0.3.0' } }))
    await write('plugins/gamma/cordis.patch.yml', '- insert:\n    - id: gamma\n      name: dsh-plugin-gamma\n')
    const commit = await commitAll()

    const result = buildMarketIndex({ root: dir, repoUrl: REPO, author: 'fixture' })

    expect(result.commit).toBe(commit)
    expect(result.warnings).toEqual(['plugins/beta/package.json: skipped because it is private'])
    expect(result.index.plugins.map((entry) => entry.name)).toEqual(['dsh-plugin-alpha', 'dsh-plugin-gamma'])

    const alpha = result.index.plugins[0]
    expect(alpha?.versions[0]).toMatchObject({
      version: '1.2.3',
      publishTimestamp: TIMESTAMP,
      source: { type: 'git', url: REPO, commit, path: 'plugins/alpha' },
      engines: { dsh: '0.2.2-rc.1' },
    })
    expect(alpha?.repository).toEqual({ url: REPO, directory: 'plugins/alpha' })
    expect(alpha?.description).toBe('dsh-plugin-alpha fixture')

    const gamma = result.index.plugins[1]
    expect(gamma?.versions[0]?.engines.dsh).toBe('>=0.2.0 <0.3.0')
  })

  it('skips a manifest whose patch file is absent at the commit', async () => {
    await manifest('plugins/alpha/package.json', plugin('dsh-plugin-alpha'))
    await commitAll()

    const result = buildMarketIndex({ root: dir, repoUrl: REPO })
    expect(result.index.plugins).toEqual([])
    expect(result.warnings[0]).toContain('cordis.patch.yml is not at')
  })
})

describe('verifyMarketIndex', () => {
  async function sample(): Promise<{ index: MarketIndex; commit: string }> {
    await manifest('plugins/alpha/package.json', plugin('dsh-plugin-alpha'))
    await write('plugins/alpha/cordis.patch.yml', '- insert:\n    - id: alpha\n      name: dsh-plugin-alpha\n')
    const commit = await commitAll()
    return { index: buildMarketIndex({ root: dir, repoUrl: REPO }).index, commit }
  }

  it('accepts an index that describes its commit', async () => {
    const { index } = await sample()
    expect(verifyMarketIndex({ root: dir, index, repoUrl: REPO })).toEqual([])
  })

  it('reports a version that the manifest does not have', async () => {
    const { index } = await sample()
    const broken = JSON.parse(JSON.stringify(index)) as { plugins: { versions: { version: string }[] }[] }
    broken.plugins[0]!.versions[0]!.version = '9.9.9'
    const problems = verifyMarketIndex({ root: dir, index: broken as unknown as MarketIndex, repoUrl: REPO })
    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toContain('manifest version')
  })

  it('reports a commit that is no longer in the repository', async () => {
    const { index } = await sample()
    const broken = JSON.parse(JSON.stringify(index)) as { plugins: { versions: { source: { commit: string } }[] }[] }
    broken.plugins[0]!.versions[0]!.source.commit = 'f'.repeat(40)
    const problems = verifyMarketIndex({ root: dir, index: broken as unknown as MarketIndex, repoUrl: REPO })
    expect(problems[0]?.message).toContain('is not in this repository')
  })

  it('reports an engines.dsh range the manifest no longer declares', async () => {
    const { index } = await sample()
    const broken = JSON.parse(JSON.stringify(index)) as { plugins: { versions: { engines: { dsh: string } }[] }[] }
    broken.plugins[0]!.versions[0]!.engines.dsh = '^1.0.0'
    const problems = verifyMarketIndex({ root: dir, index: broken as unknown as MarketIndex, repoUrl: REPO })
    expect(problems[0]?.message).toContain('engines.dsh')
  })
})

describe('readMarketIndex', () => {
  it('reads a written index and resolves it through the validator', async () => {
    await manifest('plugins/alpha/package.json', plugin('dsh-plugin-alpha'))
    await write('plugins/alpha/cordis.patch.yml', '- insert:\n    - id: alpha\n      name: dsh-plugin-alpha\n')
    await commitAll()
    const index = buildMarketIndex({ root: dir, repoUrl: REPO }).index
    const path = join(dir, 'index.json')
    await writeFile(path, JSON.stringify(index, null, 2) + '\n')

    expect(readMarketIndex(path).plugins.map((entry) => entry.name)).toEqual(['dsh-plugin-alpha'])
  })
})
