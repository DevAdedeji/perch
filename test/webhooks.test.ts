import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  isRetryableWebhookStatus,
  MAX_WEBHOOK_ATTEMPTS,
  signWebhook,
  webhookDeliveryEnabled,
  webhookEnvelope,
  webhookRetryAt
} from '../server/utils/webhooks'
import {
  isPublicIp,
  isSafeWebhookUrl,
  postWebhook,
  resolvePublicTarget,
  safeWebhookError,
  webhookAuditTarget,
  webhookTargetPolicy
} from '../server/utils/webhook-security'

const SECRET = 'whsec_test_secret'

describe('signWebhook', () => {
  it('produces a signature a receiver can independently verify', () => {
    const t = 1_752_800_000
    const body = '{"event":"conversation.created","data":{}}'
    const sig = signWebhook(SECRET, t, body)
    const expected = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')
    expect(sig).toBe(expected)
  })

  it('rejects private and special IPv6 targets', () => {
    expect(isSafeWebhookUrl('http://[::1]/hook')).toBe(false)
    expect(isSafeWebhookUrl('http://[fd00::1]/hook')).toBe(false)
    expect(isSafeWebhookUrl('http://[fe80::1]/hook')).toBe(false)
    expect(isPublicIp('::ffff:127.0.0.1')).toBe(false)
    expect(isPublicIp('::ffff:7f00:1')).toBe(false)
    expect(isPublicIp('::7f00:1')).toBe(false)
    expect(isPublicIp('::ffff:a00:1')).toBe(false)
    expect(isPublicIp('::ffff:808:808')).toBe(true)
    expect(isPublicIp('2002:a00:1::')).toBe(false)
    expect(isPublicIp('2001:0000:4136:e378:8000:63bf:3fff:fdd2')).toBe(false)
    expect(isPublicIp('2606:4700:4700::1111')).toBe(true)
  })

  it('rejects credentials in webhook URLs', () => {
    expect(isSafeWebhookUrl('https://user:password@example.com/hook')).toBe(false)
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

describe('durable webhook delivery policy', () => {
  it('keeps one stable event identity across retries', () => {
    const createdAt = new Date('2026-09-02T12:00:00.000Z')
    const body = webhookEnvelope('message.created', { message: { id: 'message-1' } }, {
      id: 'event-1',
      createdAt
    })
    expect(JSON.parse(body)).toEqual({
      id: 'event-1',
      event: 'message.created',
      created_at: createdAt.toISOString(),
      data: { message: { id: 'message-1' } }
    })
  })

  it('retries temporary failures but dead-letters permanent client errors', () => {
    for (const status of [null, 408, 425, 429, 500, 503]) expect(isRetryableWebhookStatus(status)).toBe(true)
    for (const status of [400, 401, 403, 404, 422]) expect(isRetryableWebhookStatus(status)).toBe(false)
  })

  it('uses bounded exponential delays and a fixed maximum attempt count', () => {
    const now = new Date('2026-09-02T12:00:00.000Z')
    expect(MAX_WEBHOOK_ATTEMPTS).toBe(6)
    expect(webhookRetryAt(1, now).getTime() - now.getTime()).toBe(10_000)
    expect(webhookRetryAt(2, now).getTime() - now.getTime()).toBe(60_000)
    expect(webhookRetryAt(6, now).getTime() - now.getTime()).toBe(2 * 60 * 60_000)
  })

  it('fails closed unless outbound delivery is explicitly enabled', () => {
    expect(webhookDeliveryEnabled({})).toBe(false)
    expect(webhookDeliveryEnabled({ PERCH_WEBHOOK_DELIVERY_ENABLED: 'false' })).toBe(false)
    expect(webhookDeliveryEnabled({ PERCH_WEBHOOK_DELIVERY_ENABLED: 'true' })).toBe(true)
  })
})

describe('isSafeWebhookUrl', () => {
  it('accepts normal HTTPS endpoints and allows HTTP only outside production', () => {
    expect(isSafeWebhookUrl('https://example.com/hooks/perch')).toBe(true)
    expect(isSafeWebhookUrl('http://api.example.com:8080/hook', { allowHttp: true })).toBe(true)
    expect(isSafeWebhookUrl('http://api.example.com:8080/hook', { allowHttp: false })).toBe(false)
    expect(webhookTargetPolicy({ NODE_ENV: 'production' })).toEqual({ allowHttp: false, allowLocalhost: false })
    expect(webhookTargetPolicy({})).toEqual({ allowHttp: false, allowLocalhost: false })
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
    expect(isSafeWebhookUrl('http://[::ffff:7f00:1]/hook', { allowHttp: true })).toBe(false)
    expect(isSafeWebhookUrl('http://[::7f00:1]/hook', { allowHttp: true })).toBe(false)
  })

  it('allows only explicit loopback testing outside production', () => {
    expect(isSafeWebhookUrl('http://localhost:9090/hook', { allowHttp: true, allowLocalhost: true })).toBe(true)
    expect(isSafeWebhookUrl('http://127.0.0.1:9090/hook', { allowHttp: true, allowLocalhost: true })).toBe(true)
    expect(isSafeWebhookUrl('http://10.0.0.1:9090/hook', { allowHttp: true, allowLocalhost: true })).toBe(false)
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

describe('webhook target resolution and timeouts', () => {
  it('rejects a hostname if any DNS result is private', async () => {
    await expect(resolvePublicTarget('https://hooks.example.com/perch', {
      resolver: async () => [
        { address: '203.1.2.3', family: 4 },
        { address: '10.0.0.5', family: 4 }
      ]
    })).rejects.toThrow('non-public address')
  })

  it('bounds DNS resolution time', async () => {
    const started = Date.now()
    await expect(resolvePublicTarget('https://hooks.example.com/perch', {
      resolver: async () => await new Promise(() => {}),
      dnsTimeoutMs: 20
    })).rejects.toThrow('DNS lookup timed out')
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('bounds the complete HTTP request during explicit local testing', async () => {
    const server = createServer(() => {})
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind')

    try {
      await expect(postWebhook(
        `http://127.0.0.1:${address.port}/private/path?token=secret`,
        '{}',
        { 'content-type': 'application/json' },
        {
          allowHttp: true,
          allowLocalhost: true,
          requestTimeoutMs: 25,
          totalTimeoutMs: 75
        }
      )).rejects.toThrow(/timed out/)
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})

describe('webhook log redaction', () => {
  it('keeps only the public target origin', () => {
    expect(webhookAuditTarget('https://user:secret@example.com:8443/private/hook?token=abc'))
      .toBe('https://example.com:8443')
    expect(safeWebhookError(new Error('Request to https://example.com/private?token=abc failed')))
      .toBe('Request to https://example.com failed')
  })
})
