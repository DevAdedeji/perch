import { and, eq, sessions } from '@perch/db'
import { z } from 'zod'

/** Revoke one session. Revoking the current one is a sign-out. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.string().uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid session id' })
  }

  const [deleted] = await useDb().delete(sessions)
    .where(and(eq(sessions.id, id.data), eq(sessions.userId, user.id)))
    .returning()
  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  }
  forgetSessions([deleted.id])

  const current = deleted.id === await currentSessionId(event)
  if (current) await clearUserSession(event)
  return { ok: true, signed_out: current }
})
