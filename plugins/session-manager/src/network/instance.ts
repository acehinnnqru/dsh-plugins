/**
 * Stable installation identity for this DSH home.
 *
 * The node id is assigned by one server, but a plugin installation is one
 * physical DSH home and may switch servers or groups. This hash is generated
 * once, persisted beside the node keys, and sent on every register and hello.
 * @module dsh-plugin-session-manager/network/instance
 */

import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dshHome } from './identity.ts'

/** One persisted installation identity. */
export interface InstanceIdentity {
  readonly v: 1
  /** Immutable installation hash, `nid_` plus 64 lowercase hex characters. */
  readonly id: string
  readonly createdAt: number
}

/** Identity file path inside one DSH home. */
export function instancePath(): string {
  return join(dshHome(), 'session-manager', 'instance.json')
}

/** Generate one installation hash. */
export function newInstanceId(): string {
  return 'nid_' + createHash('sha256').update(randomBytes(32)).digest('hex')
}

/** Whether one string is a valid installation hash. */
export function isInstanceId(value: unknown): value is string {
  return typeof value === 'string' && /^nid_[0-9a-f]{64}$/.test(value)
}

/** Parse one persisted record. */
function parse(raw: string): InstanceIdentity | undefined {
  try {
    const value = JSON.parse(raw) as Partial<InstanceIdentity>
    if (value.v !== 1 || !isInstanceId(value.id) || typeof value.createdAt !== 'number') return undefined
    return { v: 1, id: value.id, createdAt: value.createdAt }
  } catch {
    return undefined
  }
}

/** Read the installation hash, creating it on first use. */
export async function loadInstance(): Promise<InstanceIdentity> {
  const path = instancePath()
  try {
    const existing = parse(await readFile(path, 'utf8'))
    if (existing !== undefined) return existing
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const created: InstanceIdentity = { v: 1, id: newInstanceId(), createdAt: Date.now() }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  try {
    await writeFile(path, JSON.stringify(created, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await chmod(path, 0o600)
    return created
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const raced = parse(await readFile(path, 'utf8'))
    if (raced === undefined) throw new Error('instance identity is unreadable')
    return raced
  }
}
