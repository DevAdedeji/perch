import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendEmail, sendEmailDetailed } from '@@/server/integrations/email'

const message = {
  to: 'local-tester@example.com',
  subject: 'Verify your test account',
  html: '<a href="http://localhost:2222/verify?token=test-token">Verify</a>',
  idempotencyKey: 'test-verification'
}

describe('email delivery environment boundary', () => {
  const request = vi.fn()
  const config = vi.fn()

  beforeEach(() => {
    request.mockReset().mockResolvedValue({ id: 'provider-message' })
    config.mockReset().mockReturnValue({ resendApiKey: 'configured-test-key', emailFrom: 'Perch <test@example.com>' })
    vi.stubGlobal('$fetch', request)
    vi.stubGlobal('useRuntimeConfig', config)
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('logs usable development previews without contacting Resend even with credentials', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('RESEND_API_KEY', 'configured-environment-key')

    const result = await sendEmailDetailed(message)

    expect(console.info).toHaveBeenCalledWith('[email:development] Preview only; no email sent', {
      to: message.to, subject: message.subject, html: message.html
    })
    expect(request).not.toHaveBeenCalled()
    expect(config).not.toHaveBeenCalled()
    expect(result).toEqual({ accepted: true, providerMessageId: expect.stringMatching(/^dev-/), retryable: false, error: null })
    expect(await sendEmail(message)).toBe(true)
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('configured-environment-key')
  })

  it('also completes development delivery without credentials', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('RESEND_API_KEY', '')
    config.mockReturnValue({ resendApiKey: '', emailFrom: '' })

    expect(await sendEmail(message)).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })

  it('still sends through Resend in production-mode deployments without logging content', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    expect(await sendEmailDetailed(message)).toEqual({ accepted: true, providerMessageId: 'provider-message', retryable: false, error: null })
    expect(request).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
      headers: { 'Authorization': 'Bearer configured-test-key', 'Idempotency-Key': message.idempotencyKey },
      body: { from: 'Perch <test@example.com>', to: message.to, subject: message.subject, html: message.html }
    }))
    expect(console.info).not.toHaveBeenCalled()
  })

  it('does not turn missing production credentials into a successful preview', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RESEND_API_KEY', '')
    config.mockReturnValue({ resendApiKey: '', emailFrom: '' })

    expect(await sendEmailDetailed(message)).toMatchObject({ accepted: false, retryable: true, error: 'email_provider_not_configured' })
    expect(console.info).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('test-token')
  })
})
