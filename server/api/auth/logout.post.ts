import { eq, sessions } from '@perch/db'

export default defineEventHandler(async (event) => {
  const sessionId = await currentSessionId(event)
  if (sessionId) {
    await useDb().delete(sessions).where(eq(sessions.id, sessionId))
    forgetSessions([sessionId])
  }
  await clearUserSession(event)
  return { ok: true }
})
