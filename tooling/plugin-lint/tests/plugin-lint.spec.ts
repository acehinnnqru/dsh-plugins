import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lintPlugin } from '../src/index.ts'

describe('lintPlugin', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'plugin-lint-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reports no finding for any directory while the rule table is empty', async () => {
    expect(await lintPlugin(dir)).toEqual([])
  })
})
