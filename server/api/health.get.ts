import { sql } from '@perch/db'

/**
 * Readiness check: proves required signing configuration and the database are
 * available. The landing page is prerendered, so pinging `/` proves neither.
 */
export default defineEventHandler(async (event) => {
  requireRealtimeSecret(event)
  const startedAt = Date.now()
  await useDb().execute(sql`select 1`)
  return {
    ok: true,
    db: 'up',
    db_latency_ms: Date.now() - startedAt,
    time: new Date().toISOString()
  }
})
