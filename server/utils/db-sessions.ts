import { eq, sessions } from '@perch/db'
import type { H3Event } from 'h3'
import type { SessionUser } from './require-user'

/**
 * Server-side session registry (sealed cookies alone can't be revoked).
 *
 * Every sign-in inserts a `sessions` row and stamps its id into the sealed
 * cookie; `requireUser` then checks the row still exists. A 60s in-memory
 * liveness cache keeps the hot path off the database — revocation propagates
 * within that window (immediately for requests hitting this instance's cache,
 * which is all of them at 1 replica).
 */

const CACHE_MS = 60_000
const BUMP_MS = 5 * 60_000

interface CacheEntry {
  until: number
  lastBump: number
}

const alive = new Map<string, CacheEntry>()

/** Create a registry row for a fresh sign-in and seal its id into the cookie. */
export async function createDbSession(event: H3Event, user: SessionUser) {
  const [row] = await useDb().insert(sessions).values({
    userId: user.id,
    userAgent: (getHeader(event, 'user-agent') ?? '').slice(0, 300) || null,
    ip: requestIp(event)
  }).returning()

  await setUserSession(event, { user, sessionId: row!.id })
  alive.set(row!.id, { until: Date.now() + CACHE_MS, lastBump: Date.now() })
  return row!
}

/** Throw 401 (and drop the cookie) unless the session row is still alive. */
export async function assertSessionAlive(event: H3Event, sessionId: string | undefined, userId: string) {
  // cookies minted before the registry existed carry no id — force a re-login
  if (!sessionId) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Session expired — please sign in again' })
  }

  const now = Date.now()
  const hit = alive.get(sessionId)
  if (hit && hit.until > now) return

  const row = await useDb().query.sessions.findFirst({ where: eq(sessions.id, sessionId) })
  if (!row || row.userId !== userId) {
    alive.delete(sessionId)
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Session expired — please sign in again' })
  }

  const lastBump = hit?.lastBump ?? 0
  alive.set(sessionId, { until: now + CACHE_MS, lastBump })
  if (now - lastBump > BUMP_MS) {
    alive.set(sessionId, { until: now + CACHE_MS, lastBump: now })
    // fire-and-forget — last-seen freshness is never worth failing a request
    useDb().update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId))
      .catch(() => {})
  }
}

/** Evict revoked ids from the liveness cache so revocation is instant here. */
export function forgetSessions(ids: string[]) {
  for (const id of ids) alive.delete(id)
}

/** The current request's registry session id (from the sealed cookie). */
export async function currentSessionId(event: H3Event): Promise<string | undefined> {
  const session = await getUserSession(event) as { sessionId?: string }
  return session.sessionId
}
