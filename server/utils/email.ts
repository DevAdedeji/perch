/**
 * Transactional email via Resend's REST API (no SDK dependency).
 * Best-effort by design: callers treat email as a side channel — a failed
 * send never fails the request that triggered it. Without RESEND_API_KEY
 * (local dev), emails are logged to the server console instead.
 */

interface SendEmailOptions {
  to: string
  subject: string
  html: string
}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<boolean> {
  const config = useRuntimeConfig()
  const apiKey = config.resendApiKey || process.env.RESEND_API_KEY
  const from = config.emailFrom || process.env.RESEND_FROM || 'Perch <no-reply@perch.adedeji.xyz>'

  if (!apiKey) {
    console.warn(`[email] RESEND_API_KEY not set — would have sent to ${to}: "${subject}"`)
    return false
  }

  try {
    await $fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: { from, to, subject, html }
    })
    return true
  } catch (e) {
    console.error(`[email] failed to send "${subject}" to ${to}:`, (e as Error).message)
    return false
  }
}

/** Minimal branded shell — amber accent, dark-on-light, renders everywhere. */
export function emailLayout(opts: { title: string, body: string, ctaLabel?: string, ctaUrl?: string }): string {
  const cta = opts.ctaLabel && opts.ctaUrl
    ? `<a href="${opts.ctaUrl}" style="display:inline-block;margin-top:20px;padding:11px 22px;background:#f59e0b;color:#0f172a;font-weight:600;text-decoration:none;border-radius:10px">${opts.ctaLabel}</a>`
    : ''
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <p style="font-size:18px;font-weight:700;color:#0f172a;margin:0 0 20px">🐦 Perch</p>
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:28px">
      <h1 style="font-size:19px;color:#0f172a;margin:0 0 12px">${opts.title}</h1>
      <div style="font-size:14px;line-height:1.6;color:#475569">${opts.body}</div>
      ${cta}
    </div>
    <p style="font-size:12px;color:#94a3b8;margin:16px 4px 0">Sent by Perch — real-time support chat.</p>
  </div>
</body></html>`
}
