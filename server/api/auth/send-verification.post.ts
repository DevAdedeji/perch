import { eq, users } from '@perch/db'

/** Resend the verification email for the signed-in (still unverified) user. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  assertRateLimit('send-verification:user', user.id, { max: 3, windowMs: 15 * 60 * 1000 })

  const dbUser = await useDb().query.users.findFirst({ where: eq(users.id, user.id) })
  if (!dbUser) {
    throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }
  if (dbUser.emailVerifiedAt) {
    return { ok: true, already_verified: true }
  }

  await sendVerificationEmail(event, { userId: dbUser.id, name: dbUser.name, email: dbUser.email })
  return { ok: true }
})
