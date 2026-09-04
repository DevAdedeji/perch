import type { H3Event } from 'h3'
import { eq, users } from '@perch/db'

export function isPlatformAdminEmail(event: H3Event, email: string) {
  const allowed = (useRuntimeConfig(event).adminEmails || process.env.PERCH_ADMIN_EMAILS || '')
    .split(',').map((entry: string) => entry.trim().toLowerCase()).filter(Boolean)
  return allowed.includes(email.toLowerCase())
}

/** Hide operator-only endpoints unless the signed-in email is allowlisted. */
export async function requirePlatformAdmin(event: H3Event) {
  const user = await requireUser(event)
  const dbUser = await useDb().query.users.findFirst({
    columns: { email: true },
    where: eq(users.id, user.id)
  })
  if (!dbUser || !isPlatformAdminEmail(event, dbUser.email)) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  return { ...user, email: dbUser.email }
}
