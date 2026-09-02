import { and, eq, lt, sessions, sql, visitors } from '@perch/db'
import type { Database } from '@perch/db'
import type { VisitorMetadata } from '@perch/shared'
import {
  encodeSessionClientContext,
  isEncodedSessionClientContext,
  parseClientContext,
  SESSION_IDLE_TTL_MS,
  SESSION_IP_RETENTION_MS
} from './client-context'
import { forgetSessions } from './db-sessions'

const LEGACY_BATCH_SIZE = 250

export interface PrivacyRetentionResult {
  expiredSessions: number
  clearedSessionIps: number
  sanitizedSessionAgents: number
  sanitizedVisitorAgents: number
}

/**
 * Enforce documented retention and gradually scrub legacy raw user agents.
 * Every update compares the value it read so a concurrent request always wins.
 */
export async function runPrivacyRetentionSweep(
  db: Database = useDb(),
  now = new Date()
): Promise<PrivacyRetentionResult> {
  const sessionCutoff = new Date(now.getTime() - SESSION_IDLE_TTL_MS)
  const ipCutoff = new Date(now.getTime() - SESSION_IP_RETENTION_MS)

  const expired = await db.delete(sessions)
    .where(lt(sessions.lastSeenAt, sessionCutoff))
    .returning({ id: sessions.id })
  forgetSessions(expired.map(row => row.id))

  const clearedIps = await db.update(sessions)
    .set({ ip: null })
    .where(and(sql`${sessions.ip} is not null`, lt(sessions.createdAt, ipCutoff)))
    .returning({ id: sessions.id })

  const legacySessions = await db.select({ id: sessions.id, userAgent: sessions.userAgent })
    .from(sessions)
    .where(and(sql`${sessions.userAgent} is not null`, sql`${sessions.userAgent} not like 'perch-device:v1:%'`))
    .limit(LEGACY_BATCH_SIZE)
  let sanitizedSessionAgents = 0
  for (const row of legacySessions) {
    if (!row.userAgent || isEncodedSessionClientContext(row.userAgent)) continue
    const updated = await db.update(sessions)
      .set({ userAgent: encodeSessionClientContext(row.userAgent) })
      .where(and(eq(sessions.id, row.id), eq(sessions.userAgent, row.userAgent)))
      .returning({ id: sessions.id })
    sanitizedSessionAgents += updated.length
  }

  const legacyVisitors = await db.select({ id: visitors.id, metadata: visitors.metadata })
    .from(visitors)
    .where(sql`${visitors.metadata} ? 'ua'`)
    .limit(LEGACY_BATCH_SIZE)
  let sanitizedVisitorAgents = 0
  for (const row of legacyVisitors) {
    const rawUa = typeof row.metadata.ua === 'string' ? row.metadata.ua : null
    const context = parseClientContext(rawUa)
    const safeContext: VisitorMetadata = {
      browser: context.browser,
      os: context.os ?? undefined,
      device: context.device
    }
    const updated = await db.update(visitors).set({
      metadata: sql`(${visitors.metadata} - 'ua') || ${JSON.stringify(safeContext)}::jsonb`
    }).where(and(
      eq(visitors.id, row.id),
      rawUa
        ? sql`${visitors.metadata}->>'ua' = ${rawUa}`
        : sql`${visitors.metadata} ? 'ua'`
    )).returning({ id: visitors.id })
    sanitizedVisitorAgents += updated.length
  }

  return {
    expiredSessions: expired.length,
    clearedSessionIps: clearedIps.length,
    sanitizedSessionAgents,
    sanitizedVisitorAgents
  }
}
