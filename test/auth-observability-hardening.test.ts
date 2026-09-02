import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sanitizeSentryUrl, scrubSentryBreadcrumb, scrubSentryEvent } from '../config/sentry-privacy'
import { contentSecurityPolicy } from '../server/utils/request-security'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('authentication and observability hardening', () => {
  it('performs an expensive password verification for unknown accounts too', () => {
    const login = source('../server/api/auth/login.post.ts')
    const validators = source('../server/utils/validators.ts')
    expect(login).toContain('loginDummyPasswordHash()')
    expect(login).toContain('user?.passwordHash ?? fallbackHash')
    expect(login).toContain('await verifyPassword')
    expect(login.indexOf('await verifyPassword')).toBeLessThan(login.indexOf('if (!user?.passwordHash'))
    expect(validators).toContain('password: z.string().min(1, \'Password is required\').max(200)')
  })

  it('strips customer and credential material from Sentry events', () => {
    const event = scrubSentryEvent({
      message: 'Failed for customer@example.com',
      user: { id: 'user-id', email: 'customer@example.com', ip_address: '203.0.113.4' },
      tags: { workspace: 'secret-workspace' },
      extra: { message: 'customer chat content' },
      request: {
        method: 'post',
        url: 'https://useperch.xyz/api/conversations/11111111-1111-4111-8111-111111111111?token=secret',
        headers: { authorization: 'Bearer secret' },
        cookies: 'session=secret',
        data: { content: 'customer chat content' }
      },
      contexts: { trace: { trace_id: 'trace', data: { email: 'customer@example.com' } }, device: { name: 'Phone' } },
      exception: {
        values: [{
          type: 'Error',
          value: 'customer chat content',
          stacktrace: {
            frames: [{
              filename: 'https://useperch.xyz/_nuxt/app.js?token=secret',
              function: 'sendMessage',
              lineno: 10,
              vars: { content: 'customer chat content' },
              context_line: 'throw new Error(customerMessage)'
            }]
          }
        }]
      },
      breadcrumbs: [
        { category: 'console', message: 'customer chat content' },
        { category: 'http', message: 'customer@example.com', data: { url: 'https://customer.example/path?secret=1', method: 'get', request_body: 'secret' } }
      ]
    })

    expect(event).not.toHaveProperty('user')
    expect(event).not.toHaveProperty('tags')
    expect(event).not.toHaveProperty('extra')
    expect(event.message).toBeUndefined()
    expect(event.request).toEqual({
      method: 'POST',
      url: '/api/conversations/[id]'
    })
    expect(event.contexts).toEqual({ trace: { trace_id: 'trace' } })
    expect(event.exception?.values?.[0]).toMatchObject({ type: 'Error', value: '[redacted]' })
    expect(event.exception?.values?.[0]?.stacktrace).not.toHaveProperty('frames.0.vars')
    expect(event.exception?.values?.[0]?.stacktrace).not.toHaveProperty('frames.0.context_line')
    expect(event.breadcrumbs).toEqual([{ category: 'http', data: { url: '/path', method: 'GET' } }])
    expect(JSON.stringify(event)).not.toContain('customer@example.com')
    expect(JSON.stringify(event)).not.toContain('customer chat content')
    expect(JSON.stringify(event)).not.toContain('secret')
  })

  it('drops console breadcrumbs and removes hosts, queries, and identifiers from URLs', () => {
    expect(scrubSentryBreadcrumb({ category: 'console', message: 'private' })).toBeNull()
    expect(sanitizeSentryUrl('https://hooks.customer.example/path/22222222-2222-4222-8222-222222222222?token=private'))
      .toBe('/path/[id]')
    expect(sanitizeSentryUrl('POST /api/widget/messages?visitor_session=private')).toBe('POST /api/widget/messages')
    expect(sanitizeSentryUrl('/reply/customer%40example.com')).toBe('/reply/[email]')
  })

  it('uses opt-in client reporting and applies privacy hooks on both runtimes', () => {
    const client = source('../sentry.client.config.ts')
    const server = source('../sentry.server.config.ts')
    expect(client).toContain('const config = useRuntimeConfig()')
    expect(client).toContain('String(config.public.sentryDsn || \'\')')
    expect(client).not.toContain('432fb2dc815bcc741bc1415a25ae2678')
    for (const config of [client, server]) {
      expect(config).toContain('sendDefaultPii: false')
      expect(config).toContain('beforeBreadcrumb: scrubSentryBreadcrumb')
      expect(config).toContain('beforeSend: scrubSentryEvent')
      expect(config).toContain('beforeSendTransaction: scrubSentryEvent')
    }
  })

  it('sets a restrictive production CSP while preserving explicit development HMR support', () => {
    const production = contentSecurityPolicy('\'none\'')
    for (const directive of [
      'default-src \'self\'',
      'object-src \'none\'',
      'script-src-attr \'none\'',
      'img-src \'self\' data: blob: https://res.cloudinary.com',
      'connect-src \'self\' https://*.ingest.us.sentry.io',
      'frame-src \'none\'',
      'frame-ancestors \'none\'',
      'upgrade-insecure-requests'
    ]) expect(production).toContain(directive)
    expect(production).not.toContain('\'unsafe-eval\'')

    const development = contentSecurityPolicy('\'none\'', true)
    expect(development).toContain('\'unsafe-eval\'')
    expect(development).toContain('ws: wss:')
    expect(development).not.toContain('upgrade-insecure-requests')
  })
})
