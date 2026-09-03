import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Webhook } from 'svix'
import { verifyResendWebhook } from '../server/utils/resend-webhooks'

function signedEvent(payload: string, timestamp = new Date()) {
  const secret = `whsec_${randomBytes(32).toString('base64')}`
  const id = 'msg_resend_webhook_test'
  return {
    secret,
    headers: {
      id,
      timestamp: String(Math.floor(timestamp.getTime() / 1000)),
      signature: new Webhook(secret).sign(id, timestamp, payload)
    }
  }
}

describe('Resend webhook verification', () => {
  it.each([
    ['email.bounced', 'bounce'],
    ['email.complained', 'complaint']
  ] as const)('verifies %s from the untouched body', (type, suppressionReason) => {
    const payload = JSON.stringify({ type, data: { email_id: 'resend-email-1', to: ['private@example.com'] } })
    const signed = signedEvent(payload)
    expect(verifyResendWebhook(payload, signed.headers, signed.secret)).toEqual({
      type,
      providerMessageId: 'resend-email-1',
      suppressionReason
    })
  })

  it('rejects tampering, missing headers, and stale signed requests', () => {
    const payload = JSON.stringify({ type: 'email.bounced', data: { email_id: 'resend-email-1' } })
    const current = signedEvent(payload)
    expect(() => verifyResendWebhook(`${payload} `, current.headers, current.secret)).toThrow()
    expect(() => verifyResendWebhook(payload, { ...current.headers, id: undefined }, current.secret)).toThrow()

    const old = signedEvent(payload, new Date(Date.now() - 10 * 60_000))
    expect(() => verifyResendWebhook(payload, old.headers, old.secret)).toThrow()
  })

  it('acknowledges unrelated signed events without processing an address', () => {
    const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 'resend-email-1' } })
    const signed = signedEvent(payload)
    expect(verifyResendWebhook(payload, signed.headers, signed.secret)).toEqual({
      type: 'email.delivered', providerMessageId: null, suppressionReason: null
    })
  })

  it('rejects a signed suppression event without a provider message ID', () => {
    const payload = JSON.stringify({ type: 'email.complained', data: {} })
    const signed = signedEvent(payload)
    expect(() => verifyResendWebhook(payload, signed.headers, signed.secret)).toThrow('resend_webhook_payload_invalid')
  })
})
