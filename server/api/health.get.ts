import { sql } from '@perch/db'

/**
 * Readiness check: proves required signing configuration and the database are
 * available. The landing page is prerendered, so pinging `/` proves neither.
 */
export default defineEventHandler(async (event) => {
  try {
    requireRealtimeSecret(event)
  } catch (error) {
    console.error('[health] signing configuration is not ready', {
      requestId: event.context.requestId,
      ...safeErrorSummary(error)
    })
    throw createError({ statusCode: 503, statusMessage: 'Service is not ready' })
  }

  const startedAt = Date.now()
  try {
    await useDb().execute(sql`select 1`)
  } catch (error) {
    console.error('[health] database is not ready', {
      requestId: event.context.requestId,
      ...safeErrorSummary(error)
    })
    throw createError({ statusCode: 503, statusMessage: 'Service is not ready' })
  }
  return {
    ok: true,
    db: 'up',
    db_latency_ms: Date.now() - startedAt,
    time: new Date().toISOString()
  }
})
