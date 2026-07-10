import { createHash } from 'node:crypto'
import { and, eq, isNull, passwordResetTokens, users } from '@perch/db'
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
 * NB: existing sessions are sealed cookies (stateless), so they can't be
 * revoked server-side — an attacker with a live session keeps it until the
 * cookie expires. Acceptable for this threat model; server-side sessions
 * would be the upgrade.
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
  const row = await db.query.passwordResetTokens.findFirst({
    where: and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt))
  })
  if (!row || row.expiresAt < new Date()) {
    throw createError({ statusCode: 400, statusMessage: 'This reset link is invalid or has expired — request a new one' })
  }

  const passwordHash = await hashPassword(password)
  await db.update(users).set({ passwordHash }).where(eq(users.id, row.userId))
  // burn this token and any other outstanding ones for the account
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, row.userId))

  return { ok: true }
})
