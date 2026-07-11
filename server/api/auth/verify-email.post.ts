import { createHash } from 'node:crypto'
import { and, emailVerificationTokens, eq, isNull, ne, users } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i)
})

/**
 * Redeem an email-verification token. Works without a session (the token
 * identifies the user — people click these from any device). For email-change
 * tokens the new address is applied here, after a last-second uniqueness check.
 */
export default defineEventHandler(async (event) => {
  assertRateLimit('verify-email:ip', requestIp(event), { max: 10, windowMs: 15 * 60 * 1000 })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid verification link' })
  }

  const tokenHash = createHash('sha256').update(result.data.token).digest('hex')
  const db = useDb()
  const row = await db.query.emailVerificationTokens.findFirst({
    where: and(eq(emailVerificationTokens.tokenHash, tokenHash), isNull(emailVerificationTokens.usedAt))
  })
  if (!row || row.expiresAt < new Date()) {
    throw createError({ statusCode: 400, statusMessage: 'This link is invalid or has expired — request a new one' })
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) })
  if (!user) {
    throw createError({ statusCode: 400, statusMessage: 'This link is invalid or has expired — request a new one' })
  }

  // email-change token: make sure nobody claimed the address in the meantime
  if (row.email !== user.email) {
    const taken = await db.query.users.findFirst({
      where: and(eq(users.email, row.email), ne(users.id, user.id))
    })
    if (taken) {
      throw createError({ statusCode: 409, statusMessage: 'That email is already in use by another account' })
    }
  }

  await db.update(users)
    .set({ email: row.email, emailVerifiedAt: new Date() })
    .where(eq(users.id, user.id))
  // burn every outstanding verification token for this account
  await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, user.id))

  return { ok: true, email: row.email }
})
