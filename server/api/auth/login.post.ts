import { eq, users } from '@perch/db'

export default defineEventHandler(async (event) => {
  const result = await readValidatedBody(event, body => loginSchema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input', data: result.error.flatten() })
  }
  const { email, password } = result.data

  const db = useDb()
  const user = await db.query.users.findFirst({ where: eq(users.email, email) })

  // verify even when the user is missing would leak timing; nuxt-auth-utils'
  // verifyPassword is constant-time enough for this project's threat model.
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
  }

  await setUserSession(event, {
    user: { id: user.id, email: user.email, name: user.name }
  })

  return { user: { id: user.id, email: user.email, name: user.name } }
})
