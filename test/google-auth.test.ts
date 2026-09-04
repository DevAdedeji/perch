import { describe, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { safeAuthRedirect } from '@perch/shared'
import { normalizeGoogleProfile } from '../server/services/google-auth'
import {
  consumeGoogleOAuthContext,
  setGoogleOAuthContext,
  validateGoogleOAuthCredentials
} from '../server/utils/google-oauth'

/** Minimal cookie jar standing in for Nitro's auto-imported h3 cookie helpers. */
function cookieJar() {
  const jar = new Map<string, string>()
  Object.assign(globalThis, {
    setCookie: (_event: H3Event, name: string, value: string) => jar.set(name, value),
    getCookie: (_event: H3Event, name: string) => jar.get(name),
    deleteCookie: (_event: H3Event, name: string) => jar.delete(name)
  })
  return jar
}

const event = {} as H3Event

describe('Google authentication boundaries', () => {
  it('keeps post-auth redirects on Perch', () => {
    expect(safeAuthRedirect('/join/invite-1?from=google', '/dashboard'))
      .toBe('/join/invite-1?from=google')
    expect(safeAuthRedirect('https://evil.example', '/dashboard')).toBe('/dashboard')
    expect(safeAuthRedirect('//evil.example', '/dashboard')).toBe('/dashboard')
    expect(safeAuthRedirect('/\\evil.example', '/dashboard')).toBe('/dashboard')
  })

  it('accepts only verified Google profiles and uses the stable subject id', () => {
    expect(normalizeGoogleProfile({
      sub: 'google-user-123',
      email: 'ADA@EXAMPLE.COM',
      email_verified: true,
      name: 'Ada Lovelace'
    })).toEqual({
      id: 'google-user-123',
      email: 'ada@example.com',
      name: 'Ada Lovelace'
    })

    expect(normalizeGoogleProfile({
      sub: 'google-user-123',
      email: 'ada@example.com',
      email_verified: false
    })).toBeNull()
  })

  it('carries the redirect across the round trip without a state of its own', () => {
    // nuxt-auth-utils issues and verifies `state` itself; a second one of ours
    // would never match what Google echoes back, failing every sign-in
    const jar = cookieJar()
    setGoogleOAuthContext(event, { redirect: '/join/invite-1', source: 'signup' })
    expect([...jar.keys()]).toEqual(['perch_google_oauth_redirect', 'perch_google_oauth_source'])

    expect(consumeGoogleOAuthContext(event)).toEqual({ redirect: '/join/invite-1', source: 'signup' })
    expect(jar.size).toBe(0)
  })

  it('falls back to the dashboard when the context cookies are gone', () => {
    cookieJar()
    expect(consumeGoogleOAuthContext(event)).toEqual({ redirect: '/dashboard', source: 'login' })
  })

  it('requires the Google client id and secret as a pair', () => {
    expect(validateGoogleOAuthCredentials({})).toBe(false)
    expect(validateGoogleOAuthCredentials({ clientId: 'client', clientSecret: 'secret' })).toBe(true)
    expect(() => validateGoogleOAuthCredentials({ clientId: 'client' }))
      .toThrow('both a client ID and client secret')
  })
})
