import { sql } from '@perch/db'

/**
 * Real health check: proves the process AND the database are up (the landing
 * page is prerendered, so pinging `/` says nothing about either). Point
 * UptimeRobot here — as a bonus, the DB ping keeps Neon's compute warm.
 */
export default defineEventHandler(async () => {
  const startedAt = Date.now()
  await useDb().execute(sql`select 1`)
  return {
    ok: true,
    db: 'up',
    db_latency_ms: Date.now() - startedAt,
    time: new Date().toISOString()
  }
})
