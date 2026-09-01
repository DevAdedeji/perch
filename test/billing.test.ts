import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PERCH_PRO_PLAN, proPriceCents, toDecimalString } from '../packages/shared/src/billing'
import { verifyBachsWebhookSignature } from '../server/utils/bachs'
import { reminderIsDue, reminderRetryAt } from '../server/utils/unanswered-reminders'

describe('Perch plan pricing', () => {
  it('keeps the yearly plan cheaper than twelve monthly payments', () => {
    expect(proPriceCents('monthly')).toBe(900)
    expect(proPriceCents('yearly')).toBe(9000)
    expect(PERCH_PRO_PLAN.yearlyCents).toBeLessThan(PERCH_PRO_PLAN.monthlyCents * 12)
    expect(toDecimalString(900)).toBe('9.00')
  })
})

describe('Bachs webhook verification', () => {
  it('accepts the signed raw body and rejects tampering', () => {
    const secret = 'whsec_test'
    const body = '{"id":"evt_1","type":"invoice.paid"}'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
    expect(verifyBachsWebhookSignature(body, timestamp, signature, secret)).toBe(true)
    expect(verifyBachsWebhookSignature(`${body} `, timestamp, signature, secret)).toBe(false)
  })

  it('rejects replayed and malformed signatures', () => {
    const stale = String(Math.floor(Date.now() / 1000) - 301)
    expect(verifyBachsWebhookSignature('{}', stale, 'invalid', 'whsec_test')).toBe(false)
    expect(verifyBachsWebhookSignature('{}', 'nope', 'invalid', 'whsec_test')).toBe(false)
  })
})

describe('unanswered reminder timing', () => {
  it('becomes due at the configured threshold', () => {
    const sentAt = new Date('2026-09-01T10:00:00Z')
    expect(reminderIsDue(sentAt, 15, new Date('2026-09-01T10:14:59Z'))).toBe(false)
    expect(reminderIsDue(sentAt, 15, new Date('2026-09-01T10:15:00Z'))).toBe(true)
  })

  it('backs off retries without exceeding six hours', () => {
    const now = new Date('2026-09-01T10:00:00Z')
    expect(reminderRetryAt(1, now).toISOString()).toBe('2026-09-01T10:05:00.000Z')
    expect(reminderRetryAt(20, now).toISOString()).toBe('2026-09-01T16:00:00.000Z')
  })
})
