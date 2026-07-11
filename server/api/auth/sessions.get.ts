import { desc, eq, sessions } from '@perch/db'

/** List the signed-in user's active sessions (devices), current one flagged. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const sessionId = await currentSessionId(event)

  const rows = await useDb().query.sessions.findMany({
    where: eq(sessions.userId, user.id),
    orderBy: desc(sessions.lastSeenAt)
  })

  return rows.map(r => ({
    id: r.id,
    user_agent: r.userAgent,
    ip: r.ip,
    created_at: r.createdAt,
    last_seen_at: r.lastSeenAt,
    current: r.id === sessionId
  }))
})
