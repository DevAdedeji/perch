import { createHash, randomBytes } from 'node:crypto'
import { emailVerificationTokens } from '@perch/db'
import type { H3Event } from 'h3'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Issue an email-verification token and send the link. `email` is the address
 * being verified: the user's own on signup, or the pending NEW address for an
 * email change (applied when the token is redeemed). Best-effort — a failed
 * email never fails the caller; in dev the link lands in the server log.
 */
export async function sendVerificationEmail(
  event: H3Event,
  opts: { userId: string, name: string, email: string, isChange?: boolean }
): Promise<boolean> {
  const token = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(token).digest('hex')

  await useDb().insert(emailVerificationTokens).values({
    userId: opts.userId,
    email: opts.email,
    tokenHash,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS)
  })

  const origin = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
  const verifyUrl = `${origin}/verify-email?token=${token}`

  const sent = await sendEmail({
    to: opts.email,
    subject: opts.isChange ? 'Confirm your new email address' : 'Verify your Perch email',
    html: emailLayout({
      title: opts.isChange ? 'Confirm your new email' : 'Verify your email',
      body: opts.isChange
        ? `<p>Hi ${opts.name},</p><p>Click below to confirm <strong>${opts.email}</strong> as the new email for your Perch account. The link is valid for 24 hours.</p><p>If you didn’t request this change, you can safely ignore this email.</p>`
        : `<p>Hi ${opts.name},</p><p>Welcome to Perch! Click below to verify your email address. The link is valid for 24 hours.</p>`,
      ctaLabel: opts.isChange ? 'Confirm new email' : 'Verify email',
      ctaUrl: verifyUrl
    })
  })
  if (!sent) console.warn(`[auth] verification link for ${opts.email}: ${verifyUrl}`)
  return sent
}
