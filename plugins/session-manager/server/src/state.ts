/**
 * Durable server state: groups, token hashes, node records, and public keys.
 *
 * The file is small and low-traffic, so every control-plane mutation rewrites it
 * atomically. Presence and replay nonces stay in memory.
 * @module session-manager-server/state
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { PeerInfo, SessionStatusRecord } from './protocol.ts'

/** One join token as stored on the server. */
export interface TokenRecord {
  readonly id: string
  readonly hash: string
  readonly createdAt: number
  readonly expiresAt: number
  readonly maxUses: number
  uses: number
  revokedAt: number | null
}

/** One registered node. */
export interface NodeRecord {
  readonly id: string
  readonly name: string
  readonly encKey: string
  readonly signKey: string
  readonly meta: { readonly hostname?: string; readonly pluginVersion?: string }
  readonly createdAt: number
  revokedAt: number | null
}

/** One group. */
export interface Group {
  readonly id: string
  readonly name: string
  readonly createdAt: number
  readonly tokens: Record<string, TokenRecord>
  readonly nodes: Record<string, NodeRecord>
  /** Shared management status keyed by Session id. */
  readonly statuses: Record<string, SessionStatusRecord>
}

/** Whole state file. */
export interface ServerState {
  readonly v: 1
  readonly createdAt: number
  readonly groups: Record<string, Group>
}

/** Group plus the record a token resolved to. */
export interface TokenResolution {
  readonly group: Group
  readonly token: TokenRecord
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

/** Expand a leading ~/ against the current home. */
export function expandHome(value: string): string {
  return value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value
}

/** Random lowercase base32 id. */
export function randomBase32(length: number): string {
  const bytes = randomBytes(length)
  let out = ''
  for (const byte of bytes) out += BASE32[byte % 32]
  return out
}

/** Mint a join token and its stored hash. */
export function mintToken(): { token: string; record: TokenRecord } {
  const id = randomBase32(12)
  const secret = randomBytes(32).toString('hex')
  return {
    token: 'smj_' + id + '_' + secret,
    record: {
      id,
      hash: hashSecret(secret),
      createdAt: Date.now(),
      expiresAt: 0,
      maxUses: 0,
      uses: 0,
      revokedAt: null,
    },
  }
}

/** SHA-256 of the raw secret bytes, hex. */
export function hashSecret(secretHex: string): string {
  return createHash('sha256').update(Buffer.from(secretHex, 'hex')).digest('hex')
}

/** Constant-time token lookup by id and secret. */
export function resolveToken(state: ServerState, token: string): TokenResolution | undefined {
  const match = /^smj_([a-z2-7]{12})_([0-9a-f]{64})$/.exec(token)
  if (match === null) return undefined
  const id = match[1]
  const secret = match[2]
  if (id === undefined || secret === undefined) return undefined
  const expected = Buffer.from(hashSecret(secret), 'hex')
  for (const group of Object.values(state.groups)) {
    const record = group.tokens[id]
    if (record === undefined) continue
    const actual = Buffer.from(record.hash, 'hex')
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return { group, token: record }
  }
  return undefined
}

/** Create a fresh server state with one group and one join token. */
export function freshState(groupName: string): { state: ServerState; group: Group; token: string } {
  const token = mintToken()
  const group: Group = {
    id: 'grp_' + randomBase32(12),
    name: groupName,
    createdAt: Date.now(),
    tokens: { [token.record.id]: token.record },
    nodes: {},
    statuses: {},
  }
  return {
    state: { v: 1, createdAt: Date.now(), groups: { [group.id]: group } },
    group,
    token: token.token,
  }
}

/** Keep only the current NodeRecord fields, dropping an old endpoint field. */
function normalizeNode(node: NodeRecord & { readonly endpoint?: unknown }): NodeRecord {
  return {
    id: node.id,
    name: node.name,
    encKey: node.encKey,
    signKey: node.signKey,
    meta: node.meta,
    createdAt: node.createdAt,
    revokedAt: node.revokedAt,
  }
}

/** Keep only valid persisted status rows. */
function normalizeStatus(value: unknown): SessionStatusRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Partial<SessionStatusRecord>
  if (
    typeof row.sessionId !== 'string' || typeof row.ownerNodeId !== 'string' ||
    typeof row.running !== 'boolean' || (typeof row.pending !== 'string' && row.pending !== null) ||
    typeof row.unread !== 'boolean' || typeof row.updatedAt !== 'number' ||
    typeof row.readAt !== 'number' || typeof row.revision !== 'number'
  ) return undefined
  return {
    sessionId: row.sessionId,
    ownerNodeId: row.ownerNodeId,
    running: row.running,
    pending: row.pending,
    unread: row.unread,
    updatedAt: row.updatedAt,
    readAt: row.readAt,
    revision: row.revision,
  }
}

/** Project one node record into a directory row. */
export function peerInfo(node: NodeRecord, online: boolean, lastSeen: number): PeerInfo {
  return {
    nodeId: node.id,
    name: node.name,
    encKey: node.encKey,
    signKey: node.signKey,
    online,
    lastSeen,
    ...(node.meta.hostname === undefined ? {} : { hostname: node.meta.hostname }),
    ...(node.meta.pluginVersion === undefined ? {} : { pluginVersion: node.meta.pluginVersion }),
  }
}

/** State file path inside one state directory. */
export function statePath(stateDir: string): string {
  return join(expandHome(stateDir), 'server.json')
}

/** Load state; a missing file is a fresh-server signal. */
export async function loadState(stateDir: string): Promise<ServerState | undefined> {
  const path = statePath(stateDir)
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as ServerState
    if (parsed.v !== 1 || typeof parsed.groups !== 'object' || parsed.groups === null) {
      throw new Error('unsupported server state version')
    }
    const groups = Object.fromEntries(Object.entries(parsed.groups).map(([id, group]) => [
      id,
      {
        ...group,
        nodes: Object.fromEntries(Object.entries(group.nodes).map(([nodeId, node]) => [nodeId, normalizeNode(node)])),
        statuses: Object.fromEntries(Object.entries(group.statuses ?? {}).flatMap(([sessionId, status]) => {
          const normalized = normalizeStatus(status)
          return normalized === undefined ? [] : [[sessionId, normalized]]
        })),
      },
    ]))
    return { ...parsed, groups }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Atomically persist state before an acknowledged control-plane result. */
export async function saveState(stateDir: string, state: ServerState): Promise<void> {
  const dir = expandHome(stateDir)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const path = statePath(dir)
  const tmp = path + '.tmp'
  const handle = await open(tmp, 'w', 0o600)
  try {
    await handle.writeFile(JSON.stringify(state, null, 2) + '\n', 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(tmp, path)
  await chmod(path, 0o600)
  const directory = await open(dirname(path), 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

/** Remove a stale temp file at startup. */
export async function removeStaleTemp(stateDir: string): Promise<void> {
  try {
    await unlink(statePath(stateDir) + '.tmp')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
