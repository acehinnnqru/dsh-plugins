#!/usr/bin/env node
/**
 * Command-line entry for the session-manager server.
 *
 * Usage: session-manager-server [--config path]
 * The first start creates the group and prints one join token; later starts keep
 * the same state and print no token.
 * @module session-manager-server
 */

import { readFile } from 'node:fs/promises'
import { startServer, type ServerConfig } from './server.ts'

/** Parse --config and load the JSON deployment file. */
async function loadConfig(argv: readonly string[]): Promise<ServerConfig> {
  const index = argv.indexOf('--config')
  const path = index >= 0 ? argv[index + 1] : undefined
  if (path === undefined) return {}
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw) as ServerConfig
}

const config = await loadConfig(process.argv.slice(2))
const server = await startServer(config)

console.log('session-manager-server listening on ws://' + (config.listen?.host ?? '127.0.0.1') + ':' + (config.listen?.port ?? 8787) + '/v1/node')
console.log('admin on http://127.0.0.1:' + (config.adminPort ?? 8788))
console.log('group ' + server.groupName + ' (' + server.groupId + ')')
if (server.token !== undefined) console.log('join token: ' + server.token)

const stop = async (): Promise<void> => {
  await server.close()
  process.exit(0)
}
process.once('SIGINT', () => { void stop() })
process.once('SIGTERM', () => { void stop() })
