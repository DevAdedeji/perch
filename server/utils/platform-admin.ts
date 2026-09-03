import type { H3Event } from 'h3'

/** Hide operator-only endpoints unless the signed-in email is allowlisted. */
export async function requirePlatformAdmin(event: H3Event) {
  const user = await requireUser(event)
  const allowed = (useRuntimeConfig(event).adminEmails || process.env.PERCH_ADMIN_EMAILS || '')
    .split(',').map((email: string) => email.trim().toLowerCase()).filter(Boolean)
  if (!allowed.includes(user.email.toLowerCase())) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  return user
}
