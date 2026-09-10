import { requireUser } from '@@/server/domains/auth/require-user'
import { currentSessionId, forgetSessions } from '@@/server/domains/auth/sessions'
import { useDb } from '@@/server/database/client'
import { and, eq, ne, sessions } from '@perch/db'

/** "Sign out everywhere else" — revoke every session except the current one. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const sessionId = await currentSessionId(event)

  const revoked = await useDb().delete(sessions)
    .where(sessionId
      ? and(eq(sessions.userId, user.id), ne(sessions.id, sessionId))
      : eq(sessions.userId, user.id))
    .returning()
  forgetSessions(revoked.map(r => r.id))

  return { ok: true, revoked: revoked.length }
})
