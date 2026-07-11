/**
 * Run pending Drizzle migrations, then exit — executed by the production
 * container BEFORE the server boots (see Dockerfile CMD), so a deploy can
 * never ship code whose schema hasn't landed yet.
 *
 * Uses the same `drizzle.__drizzle_migrations` bookkeeping as `drizzle-kit
 * migrate`, so local CLI migrations and deploy-time migrations stay in sync.
 * Bundled to a standalone file with esbuild during the Docker build.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.NEON_CONNECTION_STRING
if (!url) {
  console.error('[migrate] NEON_CONNECTION_STRING is not set — refusing to boot')
  process.exit(1)
}

const sql = postgres(url, { max: 1, connect_timeout: 15 })

try {
  const started = Date.now()
  await migrate(drizzle(sql), { migrationsFolder: './migrations' })
  console.log(`[migrate] schema up to date (${Date.now() - started}ms)`)
} catch (err) {
  console.error('[migrate] migration failed — aborting boot:', err)
  process.exit(1)
} finally {
  await sql.end()
}
