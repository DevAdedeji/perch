import { describe, expect, it } from 'vitest'
import { safeAuthRedirect } from '@perch/shared'
import { normalizeGoogleProfile } from '../server/services/google-auth'
import { validateGoogleOAuthCredentials } from '../server/utils/google-oauth'

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

  it('requires the Google client id and secret as a pair', () => {
    expect(validateGoogleOAuthCredentials({})).toBe(false)
    expect(validateGoogleOAuthCredentials({ clientId: 'client', clientSecret: 'secret' })).toBe(true)
    expect(() => validateGoogleOAuthCredentials({ clientId: 'client' }))
      .toThrow('both a client ID and client secret')
  })
})
