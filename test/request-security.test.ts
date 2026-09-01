import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  acceptsApiContentType,
  contentSecurityPolicy,
  hasRequestBody,
  isApiMutation,
  isCookieFreePublicRequest,
  isTrustedMutationOrigin,
  MAX_API_REQUEST_BYTES,
  requiresTrustedMutationOrigin,
  safeErrorSummary
} from '../server/utils/request-security'

const middlewareSource = readFileSync(
  new URL('../server/middleware/request-boundaries.ts', import.meta.url),
  'utf8'
)
const nuxtConfigSource = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')

describe('API request boundaries', () => {
  it('protects state-changing API calls while preserving provider and widget handshakes', () => {
    expect(isApiMutation('/api/auth/login', 'POST')).toBe(true)
    expect(isApiMutation('/api/auth/me', 'GET')).toBe(false)
    expect(requiresTrustedMutationOrigin('/api/auth/login', 'POST')).toBe(true)
    expect(requiresTrustedMutationOrigin('/api/webhooks/bachs', 'POST')).toBe(false)
    expect(requiresTrustedMutationOrigin('/api/widget/embed-ticket', 'POST')).toBe(false)
  })

  it('accepts only the exact application origin for cookie-authenticated mutations', () => {
    expect(isTrustedMutationOrigin('https://useperch.xyz', 'https://useperch.xyz')).toBe(true)
    expect(isTrustedMutationOrigin('https://evil.useperch.xyz', 'https://useperch.xyz')).toBe(false)
    expect(isTrustedMutationOrigin('null', 'https://useperch.xyz')).toBe(false)
    expect(isTrustedMutationOrigin(undefined, 'https://useperch.xyz')).toBe(false)
  })

  it('allows JSON bodies and the one bounded multipart upload route', () => {
    expect(acceptsApiContentType('/api/auth/login', 'application/json; charset=utf-8')).toBe(true)
    expect(acceptsApiContentType('/api/auth/login', 'text/plain')).toBe(false)
    expect(acceptsApiContentType('/api/attachments/upload', 'multipart/form-data; boundary=abc')).toBe(true)
    expect(hasRequestBody('0', undefined)).toBe(false)
    expect(hasRequestBody('12', undefined)).toBe(true)
    expect(hasRequestBody(undefined, 'chunked')).toBe(true)
  })

  it('enforces one small global body ceiling before endpoint parsing', () => {
    expect(MAX_API_REQUEST_BYTES).toBe(2 * 1024 * 1024)
    expect(middlewareSource).toContain('await assertApiBodySize(event)')
    expect(middlewareSource.indexOf('await assertApiBodySize(event)'))
      .toBeLessThan(middlewareSource.indexOf('acceptsApiContentType'))
  })

  it('keeps public probes and embeds cookie-free without breaking authenticated previews', () => {
    expect(isCookieFreePublicRequest('/api/health')).toBe(true)
    expect(isCookieFreePublicRequest('/api/widget/session')).toBe(true)
    expect(isCookieFreePublicRequest('/api/webhooks/bachs')).toBe(true)
    expect(isCookieFreePublicRequest('/help/ws_123')).toBe(true)
    expect(isCookieFreePublicRequest('/widget', false)).toBe(true)
    expect(isCookieFreePublicRequest('/widget', true)).toBe(false)
    expect(isCookieFreePublicRequest('/api/auth/login')).toBe(false)
  })
})

describe('browser security policy', () => {
  it('keeps active content and framing locked down without blocking approved widget ancestors', () => {
    expect(contentSecurityPolicy('\'none\'')).toBe(
      'base-uri \'self\'; object-src \'none\'; form-action \'self\'; frame-ancestors \'none\''
    )
    expect(contentSecurityPolicy('https://example.com')).toContain('frame-ancestors https://example.com')
  })

  it('uses cookie-only encrypted sessions and secure production cookies', () => {
    expect(nuxtConfigSource).toContain('sessionHeader: false')
    expect(nuxtConfigSource).toContain('secure: process.env.NODE_ENV === \'production\'')
    expect(nuxtConfigSource).toContain('sameSite: \'lax\'')
  })

  it('keeps production builds independent of remote font metadata', () => {
    expect(nuxtConfigSource).toMatch(/ui:\s*\{[\s\S]*?fonts: false/)
  })

  it('summarizes operational errors without returning their messages', () => {
    const summary = safeErrorSummary(Object.assign(new Error('postgresql://user:password@host/db'), {
      code: 'ECONNREFUSED',
      statusCode: 503
    }))
    expect(summary).toEqual({ type: 'Error', code: 'ECONNREFUSED', statusCode: 503 })
    expect(JSON.stringify(summary)).not.toContain('password')
  })
})
