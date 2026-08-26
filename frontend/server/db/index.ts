import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import * as schema from './schema'

/**
 * Wait briefly for another request's SQLite write transaction instead of
 * failing immediately with SQLITE_BUSY. The timeout applies to every local
 * file connection opened by @libsql/client, including transaction connections.
 */
const client = createClient({
  url: 'file:./db.sqlite',
  timeout: 5000,
})

/**
 * Configure the local SQLite file before Nitro starts accepting requests.
 * journal_mode is persisted in the database file and these statements are
 * idempotent, so running them on startup also restores WAL mode when a
 * database file is recreated.
 *
 * This is called by `server/plugins/database.ts`; it cannot be top-level
 * awaited here because Nitro's server bundle targets ES2019.
 */
let configuration: Promise<void> | undefined

export function configureDatabase(): Promise<void> {
  configuration ??= (async () => {
    await client.execute('PRAGMA journal_mode = WAL')
    await client.execute('PRAGMA synchronous = NORMAL')
  })()
  return configuration
}

export const db = drizzle(client, { schema })
