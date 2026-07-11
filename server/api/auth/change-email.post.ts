import { eq, users } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  new_email: z.string().trim().toLowerCase().email('Enter a valid email').max(200),
  password: z.string().min(1, 'Enter your password')
})

/**
 * Start an email change: re-authenticate, then send a confirmation link to the
 * NEW address. Nothing changes until that link is clicked (verify-email.post),
 * so a typo'd address can never lock anyone out.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  assertRateLimit('change-email:user', user.id, { max: 3, windowMs: 15 * 60 * 1000 })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid input' })
  }
  const { new_email, password } = result.data

  const db = useDb()
  const dbUser = await db.query.users.findFirst({ where: eq(users.id, user.id) })
  if (!dbUser || !(await verifyPassword(dbUser.passwordHash, password))) {
    throw createError({ statusCode: 401, statusMessage: 'Password is incorrect' })
  }
  if (new_email === dbUser.email) {
    throw createError({ statusCode: 400, statusMessage: 'That is already your email address' })
  }
  const taken = await db.query.users.findFirst({ where: eq(users.email, new_email) })
  if (taken) {
    throw createError({ statusCode: 409, statusMessage: 'That email is already in use' })
  }

  await sendVerificationEmail(event, {
    userId: dbUser.id,
    name: dbUser.name,
    email: new_email,
    isChange: true
  })
  return { ok: true }
})
