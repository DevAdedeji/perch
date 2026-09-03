import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendEmailDetailed } from '../server/utils/email'
import { safeErrorSummary } from '../server/utils/request-security'

const rawErrorLogFiles = [
  '../server/plugins/trigger-sweep.ts',
  '../server/plugins/automation-sweep.ts',
  '../server/plugins/unanswered-reminder-sweep.ts',
  '../server/plugins/webhook-delivery-sweep.ts',
  '../server/utils/automation-engine.ts',
  '../server/utils/installation.ts',
  '../server/utils/audit.ts',
  '../server/utils/conversations.ts',
  '../server/api/widget/identify.post.ts'
]

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('production log redaction', () => {
  it('reduces exceptions to non-content diagnostics', () => {
    const error = Object.assign(new Error('customer@example.com at https://secret.example/path?token=abc'), {
      code: 'ECONNRESET',
      statusCode: 503,
      request: { headers: { authorization: 'Bearer private' } }
    })
    expect(safeErrorSummary(error)).toEqual({ type: 'Error', code: 'ECONNRESET', statusCode: 503 })
    expect(JSON.stringify(safeErrorSummary(error))).not.toMatch(/customer|secret\.example|Bearer|private/)
  })

  it('never logs an email subject when delivery is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('useRuntimeConfig', () => ({ resendApiKey: '', emailFrom: '' }))
    const previousKey = process.env.RESEND_API_KEY
    process.env.RESEND_API_KEY = ''
    try {
      await sendEmailDetailed({
        to: 'customer@example.com',
        subject: 'Private visitor name and message',
        html: '<p>Private conversation</p>'
      })
    } finally {
      if (previousKey === undefined) delete process.env.RESEND_API_KEY
      else process.env.RESEND_API_KEY = previousKey
    }
    expect(warn).toHaveBeenCalledWith('[email] provider is not configured; delivery skipped')
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/customer@example|Private visitor|Private conversation/)
  })

  it('logs only provider status and retryability after an email transport failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('useRuntimeConfig', () => ({ resendApiKey: 'test-key', emailFrom: 'Perch <test@example.com>' }))
    vi.stubGlobal('$fetch', vi.fn(async () => {
      throw Object.assign(new Error('customer@example.com at https://api.example/private'), { statusCode: 503 })
    }))
    await sendEmailDetailed({
      to: 'customer@example.com',
      subject: 'Private visitor name',
      html: '<p>Private conversation</p>'
    })
    expect(log).toHaveBeenCalledWith('[email] provider request failed', { status: 503, retryable: true })
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/customer@example|Private visitor|Private conversation|api\.example/)
  })

  it('routes every background exception through the safe summary', () => {
    for (const path of rawErrorLogFiles) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8')
      expect(source, path).toContain('safeErrorSummary(error)')
      expect(source, path).not.toMatch(/console\.error\([^\n]*,\s*(?:err|error)\s*\)/)
    }
    const migrate = readFileSync(new URL('../scripts/migrate.mjs', import.meta.url), 'utf8')
    expect(migrate).toContain('safeErrorSummary(err)')
    expect(migrate).not.toContain('aborting boot:\', err')
  })
})
