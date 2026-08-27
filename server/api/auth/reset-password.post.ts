import { createHash } from 'node:crypto'
import { and, eq, isNull, passwordResetTokens, sessions, users } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200)
})

/**
 * Complete a password reset with a token from the email. Tokens are
 * single-use and expire after 30 minutes; on success every other outstanding
 * token for the user is invalidated too.
 *
 * Password change, token consumption, and session revocation are atomic.
 */
export default defineEventHandler(async (event) => {
  assertRateLimit('reset-password:ip', requestIp(event), { max: 10, windowMs: 15 * 60 * 1000 })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid input' })
  }
  const { token, password } = result.data

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const db = useDb()
  const passwordHash = await hashPassword(password)
  const revoked = await db.transaction(async (tx) => {
    // Deleting with RETURNING is the single-use claim: concurrent redeemers
    // cannot both acquire the same token. Throwing rolls the deletion back.
    const [row] = await tx.delete(passwordResetTokens)
      .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt)))
      .returning()
    if (!row || row.expiresAt < new Date()) {
      throw createError({ statusCode: 400, statusMessage: 'This reset link is invalid or has expired — request a new one' })
    }

    await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId))
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, row.userId))
    return tx.delete(sessions).where(eq(sessions.userId, row.userId)).returning({ id: sessions.id })
  })
  forgetSessions(revoked.map(row => row.id))

  return { ok: true, revoked_sessions: revoked.length }
})
