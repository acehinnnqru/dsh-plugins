/**
 * Node identity: Ed25519 signing key, X25519 encryption key, and the durable
 * id the server assigned. The private keys never leave the node.
 * @module dsh-plugin-session-manager/network/identity
 */

import {
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign as signBytes,
  type KeyObject,
} from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Durable node identity. */
export interface Identity {
  readonly v: 1
  readonly server: string
  readonly nodeId: string | undefined
  readonly groupId: string | undefined
  readonly name: string
  readonly encKey: string
  readonly signKey: string
  readonly privateEnc: string
  readonly privateSign: string
}

/** DSH home used by the running host. */
export function dshHome(): string {
  return process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
}

/** Identity file path. */
export function identityPath(): string {
  return join(dshHome(), 'session-manager', 'network.json')
}

/** Raw 32-byte public key from a DER SPKI export. */
function rawPublic(key: KeyObject): string {
  const der = key.export({ format: 'der', type: 'spki' })
  return Buffer.from(der.subarray(der.length - 32)).toString('base64url')
}

/** Generate a fresh identity. */
export function createIdentity(server: string, name: string): Identity {
  const sign = generateKeyPairSync('ed25519')
  const enc = generateKeyPairSync('x25519')
  return {
    v: 1,
    server,
    nodeId: undefined,
    groupId: undefined,
    name,
    encKey: rawPublic(enc.publicKey),
    signKey: rawPublic(sign.publicKey),
    privateEnc: enc.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    privateSign: sign.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  }
}

/** Load the identity for one server URL, if it exists. */
export async function loadIdentity(server: string): Promise<Identity | undefined> {
  try {
    const raw = await readFile(identityPath(), 'utf8')
    const identity = JSON.parse(raw) as Identity
    if (identity.v !== 1 || identity.server !== server) return undefined
    return identity
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Persist an identity with owner-only permissions. */
export async function saveIdentity(identity: Identity): Promise<void> {
  const path = identityPath()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, JSON.stringify(identity, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  await chmod(path, 0o600)
}

/** Sign a canonical UTF-8 string with the identity signing key. */
export function signIdentity(identity: Identity, canonical: string): string {
  const key = createPrivateKey({ key: Buffer.from(identity.privateSign, 'base64'), format: 'der', type: 'pkcs8' })
  return signBytes(null, Buffer.from(canonical, 'utf8'), key).toString('base64url')
}

/** Random 16-byte base64url nonce. */
export function nonce(): string {
  return randomBytes(16).toString('base64url')
}

/** Session id type used by the federation map. */
export type RemoteId = SessionId
