import { eq, users } from '@perch/db'

export default defineEventHandler(async (event) => {
  assertRateLimit('signup:ip', requestIp(event), { max: 5, windowMs: 60 * 60 * 1000 })

  const result = await readValidatedBody(event, body => signupSchema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input', data: result.error.flatten() })
  }
  const { name, email, password } = result.data

  const db = useDb()

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) })
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'An account with this email already exists' })
  }

  const passwordHash = await hashPassword(password)
  const [user] = await db.insert(users).values({ name, email, passwordHash }).returning()
  if (!user) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to create account' })
  }

  await createDbSession(event, { id: user.id, email: user.email, name: user.name })

  // best-effort — signup never fails because an email didn't send
  sendVerificationEmail(event, { userId: user.id, name: user.name, email: user.email }).catch(() => {})

  setResponseStatus(event, 201)
  return { user: { id: user.id, email: user.email, name: user.name } }
})
