import { eq, sql, users } from '@perch/db'
import { z } from 'zod'

const googleProfileSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().trim().toLowerCase().email().max(320),
  email_verified: z.literal(true),
  name: z.string().trim().min(1).max(100).optional(),
  given_name: z.string().trim().min(1).max(100).optional()
})

export interface GoogleProfile {
  id: string
  email: string
  name: string
}

export function normalizeGoogleProfile(input: unknown): GoogleProfile | null {
  const parsed = googleProfileSchema.safeParse(input)
  if (!parsed.success) return null

  const emailName = parsed.data.email.split('@')[0] || 'Perch user'
  return {
    id: parsed.data.sub,
    email: parsed.data.email,
    name: parsed.data.name ?? parsed.data.given_name ?? emailName
  }
}

/**
 * Resolve Google's stable account id to exactly one Perch user.
 *
 * Advisory locks serialize duplicate callbacks for the same Google identity
 * and email. This keeps first-time sign-in and account linking race-safe.
 */
export async function findOrCreateGoogleUser(input: unknown) {
  const profile = normalizeGoogleProfile(input)
  if (!profile) {
    throw createError({ statusCode: 401, statusMessage: 'Google did not return a verified account.' })
  }

  return useDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`google:${profile.id}`}))`)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`email:${profile.email}`}))`)

    const linked = await tx.query.users.findFirst({ where: eq(users.googleId, profile.id) })
    if (linked) return linked

    const byEmail = await tx.query.users.findFirst({ where: eq(users.email, profile.email) })
    if (byEmail) {
      if (byEmail.googleId && byEmail.googleId !== profile.id) {
        throw createError({
          statusCode: 409,
          statusMessage: 'This email is already connected to another Google account.'
        })
      }

      const [connected] = await tx.update(users)
        .set({
          googleId: profile.id,
          emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`
        })
        .where(eq(users.id, byEmail.id))
        .returning()
      return connected!
    }

    const [created] = await tx.insert(users).values({
      email: profile.email,
      name: profile.name,
      passwordHash: null,
      googleId: profile.id,
      emailVerifiedAt: sql`now()`
    }).returning()

    if (!created) {
      throw createError({ statusCode: 500, statusMessage: 'Could not create the Google account.' })
    }
    return created
  })
}
