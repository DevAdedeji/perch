import { createDb, type Database } from '@perch/db'

/**
 * Lazily-created singleton Drizzle client — one connection pool per server
 * instance (§5.4). Auto-imported into any server route as `useDb()`.
 */
let _db: Database | null = null

export function useDb(): Database {
  if (!_db) {
    const url = useRuntimeConfig().databaseUrl
    if (!url) {
      throw createError({ statusCode: 500, statusMessage: 'Database is not configured (NEON_CONNECTION_STRING missing)' })
    }
    _db = createDb(url)
  }
  return _db
}
