import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadState, mintToken, resolveToken, statePath } from '../server/src/state.ts'

describe('server state migration', () => {
  it('lifts its legacy group-scoped token into server scope', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'session-manager-state-'))
    const minted = mintToken()
    const legacy = {
      v: 1,
      createdAt: 1,
      groups: {
        grp_legacy: {
          id: 'grp_legacy',
          name: 'legacy',
          createdAt: 1,
          tokens: { [minted.record.id]: minted.record },
          nodes: {},
          statuses: {},
        },
      },
    }
    try {
      await writeFile(statePath(dir), JSON.stringify(legacy), 'utf8')
      const state = await loadState(dir)
      expect(state).toBeDefined()
      if (state === undefined) return
      expect(resolveToken(state, minted.token)?.id).toBe(minted.record.id)
      expect((state.groups['grp_legacy'] as unknown as { tokens?: unknown }).tokens).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
