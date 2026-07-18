import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { isSafeWebhookUrl, signWebhook } from '../server/utils/webhooks'

const SECRET = 'whsec_test_secret'

describe('signWebhook', () => {
  it('produces a signature a receiver can independently verify', () => {
    const t = 1_752_800_000
    const body = '{"event":"conversation.created","data":{}}'
    const sig = signWebhook(SECRET, t, body)
    const expected = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')
    expect(sig).toBe(expected)
  })

  it('changes when the body is tampered with', () => {
    const t = 1_752_800_000
    const sig = signWebhook(SECRET, t, '{"amount":10}')
    expect(signWebhook(SECRET, t, '{"amount":99}')).not.toBe(sig)
  })

  it('changes when the timestamp changes (replay protection)', () => {
    const body = '{"event":"x"}'
    expect(signWebhook(SECRET, 1000, body)).not.toBe(signWebhook(SECRET, 1001, body))
  })

  it('changes with the secret', () => {
    const t = 1000
    const body = '{}'
    expect(signWebhook('secret-a', t, body)).not.toBe(signWebhook('secret-b', t, body))
  })
})

describe('isSafeWebhookUrl', () => {
  it('accepts normal https and http endpoints', () => {
    expect(isSafeWebhookUrl('https://example.com/hooks/perch')).toBe(true)
    expect(isSafeWebhookUrl('http://api.example.com:8080/hook')).toBe(true)
  })

  it('rejects non-http protocols and garbage', () => {
    expect(isSafeWebhookUrl('ftp://example.com/x')).toBe(false)
    expect(isSafeWebhookUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeWebhookUrl('not a url')).toBe(false)
    expect(isSafeWebhookUrl('')).toBe(false)
  })

  it('rejects loopback and unspecified hosts', () => {
    expect(isSafeWebhookUrl('http://localhost:3000/hook')).toBe(false)
    expect(isSafeWebhookUrl('http://127.0.0.1/hook')).toBe(false)
    expect(isSafeWebhookUrl('http://127.1.2.3/hook')).toBe(false)
    expect(isSafeWebhookUrl('http://0.0.0.0/hook')).toBe(false)
    expect(isSafeWebhookUrl('http://[::1]/hook')).toBe(false)
  })

  it('rejects private and link-local ranges', () => {
    expect(isSafeWebhookUrl('http://10.0.0.5/hook')).toBe(false)
    expect(isSafeWebhookUrl('http://192.168.1.10/hook')).toBe(false)
    expect(isSafeWebhookUrl('http://172.16.0.1/hook')).toBe(false)
    expect(isSafeWebhookUrl('http://172.31.255.1/hook')).toBe(false)
    expect(isSafeWebhookUrl('http://169.254.169.254/latest/meta-data')).toBe(false)
  })

  it('allows 172.x outside the private /12', () => {
    expect(isSafeWebhookUrl('http://172.15.0.1/hook')).toBe(true)
    expect(isSafeWebhookUrl('http://172.32.0.1/hook')).toBe(true)
  })

  it('rejects .local and .internal hostnames', () => {
    expect(isSafeWebhookUrl('http://printer.local/hook')).toBe(false)
    expect(isSafeWebhookUrl('https://db.prod.internal/hook')).toBe(false)
  })
})
