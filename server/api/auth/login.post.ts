import { randomBytes } from 'node:crypto'
import { eq, users } from '@perch/db'

const dummyPassword = randomBytes(32).toString('base64url')
let dummyPasswordHash: Promise<string> | undefined

function loginDummyPasswordHash() {
  dummyPasswordHash ??= hashPassword(dummyPassword)
  return dummyPasswordHash
}

export default defineEventHandler(async (event) => {
  assertRateLimit('login:ip', requestIp(event), { max: 10, windowMs: 5 * 60 * 1000 })

  const result = await readValidatedBody(event, body => loginSchema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input', data: result.error.flatten() })
  }
  const { email, password } = result.data
  // per-account throttle so a botnet can't brute-force one mailbox across IPs
  assertRateLimit('login:email', email, { max: 10, windowMs: 5 * 60 * 1000 })

  const db = useDb()
  const [user, fallbackHash] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.email, email) }),
    loginDummyPasswordHash()
  ])
  const passwordMatches = await verifyPassword(user?.passwordHash ?? fallbackHash, password)
  if (!user?.passwordHash || !passwordMatches) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
  }

  await createDbSession(event, { id: user.id, email: user.email, name: user.name })

  return { user: { id: user.id, email: user.email, name: user.name } }
})
