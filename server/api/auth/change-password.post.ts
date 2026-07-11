import { and, eq, ne, passwordResetTokens, sessions, users } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  current_password: z.string().min(1, 'Enter your current password'),
  new_password: z.string().min(8, 'At least 8 characters').max(200)
})

/** In-app password change — always re-authenticates with the current password. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  assertRateLimit('change-password:user', user.id, { max: 5, windowMs: 15 * 60 * 1000 })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid input' })
  }

  const db = useDb()
  const dbUser = await db.query.users.findFirst({ where: eq(users.id, user.id) })
  if (!dbUser || !(await verifyPassword(dbUser.passwordHash, result.data.current_password))) {
    throw createError({ statusCode: 401, statusMessage: 'Current password is incorrect' })
  }

  const passwordHash = await hashPassword(result.data.new_password)
  await db.update(users).set({ passwordHash }).where(eq(users.id, user.id))
  // a password change invalidates any outstanding reset links…
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id))
  // …and signs out every other device (the classic stolen-laptop move)
  const sessionId = await currentSessionId(event)
  const revoked = await db.delete(sessions)
    .where(sessionId
      ? and(eq(sessions.userId, user.id), ne(sessions.id, sessionId))
      : eq(sessions.userId, user.id))
    .returning()
  forgetSessions(revoked.map(r => r.id))

  return { ok: true, revoked_sessions: revoked.length }
})
