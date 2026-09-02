import { PERCH_PRODUCTION_ORIGIN } from '@perch/shared'

/**
 * Transactional email via Resend's REST API (no SDK dependency).
 * Best-effort by design: callers treat email as a side channel — a failed
 * send never fails the request that triggered it. Without RESEND_API_KEY
 * (local dev), emails are logged to the server console instead.
 */

export interface SendEmailOptions {
  to: string
  subject: string
  html: string
  idempotencyKey?: string
}

export interface EmailDeliveryResult {
  accepted: boolean
  providerMessageId: string | null
  retryable: boolean
  error: string | null
}

const EMAIL_TIMEOUT_MS = 10_000

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'
  })[char]!)
}

/** Sensitive local preview links are never eligible for production logs. */
export function shouldLogEmailPreview(sent: boolean, isDev: boolean): boolean {
  return !sent && isDev
}

export function normalizePublicOrigin(value: string, allowHttp: boolean): string | null {
  try {
    const url = new URL(value)
    const allowedProtocol = url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')
    if (!allowedProtocol || url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

export function publicOrigin(event: import('h3').H3Event): string {
  const configured = useRuntimeConfig(event).publicBaseUrl || process.env.PERCH_PUBLIC_URL
  if (configured) {
    const origin = normalizePublicOrigin(configured, import.meta.dev)
    if (origin) return origin
    throw createError({ statusCode: 500, statusMessage: 'PERCH_PUBLIC_URL must be a valid HTTPS origin' })
  }
  return import.meta.dev
    ? getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
    : PERCH_PRODUCTION_ORIGIN
}

export async function sendEmailDetailed({ to, subject, html, idempotencyKey }: SendEmailOptions): Promise<EmailDeliveryResult> {
  const config = useRuntimeConfig()
  const apiKey = config.resendApiKey || process.env.RESEND_API_KEY
  const from = config.emailFrom || process.env.RESEND_FROM || `Perch <no-reply@${new URL(PERCH_PRODUCTION_ORIGIN).hostname}>`

  if (!apiKey) {
    console.warn(`[email] RESEND_API_KEY not set — skipped "${subject}"`)
    return { accepted: false, providerMessageId: null, retryable: true, error: 'email_provider_not_configured' }
  }

  try {
    const response = await $fetch<{ id?: string }>('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      },
      body: { from, to, subject, html },
      timeout: EMAIL_TIMEOUT_MS
    })
    return {
      accepted: true,
      providerMessageId: typeof response.id === 'string' ? response.id : null,
      retryable: false,
      error: null
    }
  } catch (e) {
    const failure = e as { status?: number, statusCode?: number, message?: string }
    const status = failure.statusCode ?? failure.status
    const retryable = status === undefined || status === 408 || status === 429 || (typeof status === 'number' && status >= 500)
    const error = `email_provider_${status ?? 'network'}`
    console.error(`[email] failed to send "${subject}":`, error)
    return { accepted: false, providerMessageId: null, retryable, error }
  }
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  return (await sendEmailDetailed(options)).accepted
}

/** Minimal branded shell — amber accent, dark-on-light, renders everywhere. */
export function emailLayout(opts: { title: string, body: string, ctaLabel?: string, ctaUrl?: string }): string {
  const cta = opts.ctaLabel && opts.ctaUrl
    ? `<a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;margin-top:20px;padding:11px 22px;background:#f59e0b;color:#0f172a;font-weight:600;text-decoration:none;border-radius:10px">${escapeHtml(opts.ctaLabel)}</a>`
    : ''
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <p style="font-size:18px;font-weight:700;color:#0f172a;margin:0 0 20px">🐦 Perch</p>
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:28px">
      <h1 style="font-size:19px;color:#0f172a;margin:0 0 12px">${escapeHtml(opts.title)}</h1>
      <div style="font-size:14px;line-height:1.6;color:#475569">${opts.body}</div>
      ${cta}
    </div>
    <p style="font-size:12px;color:#94a3b8;margin:16px 4px 0">Sent by Perch — real-time support chat.</p>
  </div>
</body></html>`
}
