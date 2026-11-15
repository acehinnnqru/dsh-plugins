import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isInstanceId, loadInstance, newInstanceId } from '../src/network/instance.ts'

const homes: string[] = []
const prior = process.env['DSH_HOME']

/** Make one isolated DSH home. */
async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'session-manager-instance-'))
  homes.push(dir)
  process.env['DSH_HOME'] = dir
  return dir
}

afterEach(async () => {
  if (prior === undefined) delete process.env['DSH_HOME']
  else process.env['DSH_HOME'] = prior
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('installation identity', () => {
  it('generates one stable hash per DSH home', async () => {
    const dir = await home()
    const first = await loadInstance()
    const second = await loadInstance()
    expect(isInstanceId(first.id)).toBe(true)
    expect(second.id).toBe(first.id)
    const raw = JSON.parse(await readFile(join(dir, 'session-manager', 'instance.json'), 'utf8')) as { id: string }
    expect(raw.id).toBe(first.id)
  })

  it('generates different hashes for different homes', async () => {
    await home()
    const first = await loadInstance()
    await home()
    const second = await loadInstance()
    expect(second.id).not.toBe(first.id)
  })

  it('generates valid random hashes', () => {
    expect(isInstanceId(newInstanceId())).toBe(true)
    expect(isInstanceId('not-a-hash')).toBe(false)
  })
})
