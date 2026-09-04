import { and, desc, eq, gt, sessions } from '@perch/db'

/** List the signed-in user's active sessions (devices), current one flagged. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const sessionId = await currentSessionId(event)

  const rows = await useDb().query.sessions.findMany({
    where: and(
      eq(sessions.userId, user.id),
      gt(sessions.lastSeenAt, new Date(Date.now() - SESSION_IDLE_TTL_MS))
    ),
    orderBy: desc(sessions.lastSeenAt)
  })

  return rows.map((r) => {
    const context = decodeSessionClientContext(r.userAgent)
    return {
      id: r.id,
      browser: context.browser,
      os: context.os,
      device_type: context.device,
      ip: r.ip,
      created_at: r.createdAt,
      last_seen_at: r.lastSeenAt,
      current: r.id === sessionId
    }
  })
})
