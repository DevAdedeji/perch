import { createHash, randomBytes } from 'node:crypto'
import { eq, passwordResetTokens, users } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  email: z.string().trim().toLowerCase().email()
})

const TOKEN_TTL_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Start a password reset. Always answers 200 with the same body so the
 * endpoint can't be used to enumerate accounts.
 */
export default defineEventHandler(async (event) => {
  const ip = requestIp(event)
  assertRateLimit('forgot-password:ip', ip, { max: 5, windowMs: 15 * 60 * 1000 })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Enter a valid email' })
  }
  const { email } = result.data
  assertRateLimit('forgot-password:email', email, { max: 3, windowMs: 15 * 60 * 1000 })

  const db = useDb()
  const user = await db.query.users.findFirst({ where: eq(users.email, email) })

  if (user) {
    const token = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS)
    })

    const origin = publicOrigin(event)
    const resetUrl = `${origin}/reset-password?token=${token}`

    const sent = await sendEmail({
      to: user.email,
      subject: 'Reset your Perch password',
      html: emailLayout({
        title: 'Reset your password',
        body: `<p>Hi ${escapeHtml(user.name)},</p><p>Someone (hopefully you) asked to reset the password for this account. The link below is valid for 30 minutes and can be used once.</p><p>If this wasn’t you, you can safely ignore this email — your password is unchanged.</p>`,
        ctaLabel: 'Choose a new password',
        ctaUrl: resetUrl
      })
    })
    // Local-only convenience. Production logs must never contain reset tokens.
    if (shouldLogEmailPreview(sent, import.meta.dev)) console.warn(`[auth] password reset link: ${resetUrl}`)
  }

  return { ok: true }
})
