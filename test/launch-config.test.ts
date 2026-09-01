import { describe, expect, it } from 'vitest'
import {
  assertProductionConfig,
  normalizeLaunchOrigin,
  productionConfigErrors,
  type LaunchEnvironment
} from '../config/launch'

const validEnvironment: LaunchEnvironment = {
  NODE_ENV: 'production',
  NEON_CONNECTION_STRING: 'postgresql://perch:secret@db.example.com/perch?sslmode=require',
  NUXT_SESSION_PASSWORD: 'correct-horse-battery-staple-849201',
  REALTIME_SECRET: 'separate-realtime-secret-unique-849201',
  PERCH_PUBLIC_URL: 'https://useperch.xyz',
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM: 'Perch <support@useperch.xyz>',
  VISITOR_REPLY_SECRET: 'visitor-reply-secret-unique-849201'
}

describe('launch configuration', () => {
  it('accepts a complete secure production baseline', () => {
    expect(productionConfigErrors(validEnvironment)).toEqual([])
    expect(() => assertProductionConfig(validEnvironment)).not.toThrow()
  })

  it('rejects insecure origins, weak secrets, and non-PostgreSQL databases', () => {
    const errors = productionConfigErrors({
      NEON_CONNECTION_STRING: 'https://db.example.com/perch',
      NUXT_SESSION_PASSWORD: 'replace-with-at-least-32-random-characters',
      REALTIME_SECRET: 'short',
      PERCH_PUBLIC_URL: 'http://useperch.xyz/dashboard'
    })

    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('NEON_CONNECTION_STRING'),
      expect.stringContaining('NUXT_SESSION_PASSWORD'),
      expect.stringContaining('REALTIME_SECRET'),
      expect.stringContaining('PERCH_PUBLIC_URL')
    ]))
  })

  it('requires optional provider credentials as complete groups without echoing values', () => {
    const privateValue = 'private-key-that-must-not-appear'
    const errors = productionConfigErrors({
      ...validEnvironment,
      BACHS_SECRET_KEY: privateValue,
      NUXT_OAUTH_GOOGLE_CLIENT_ID: 'client-id',
      CLOUDINARY_CLOUD_NAME: 'perch'
    })
    const output = errors.join('\n')

    expect(output).toContain('BACHS_SECRET_KEY, BACHS_WEBHOOK_SECRET')
    expect(output).toContain('NUXT_OAUTH_GOOGLE_CLIENT_ID')
    expect(output).toContain('CLOUDINARY_CLOUD_NAME')
    expect(output).not.toContain(privateValue)
  })

  it('requires transactional email for production account recovery', () => {
    const errors = productionConfigErrors({
      ...validEnvironment,
      RESEND_API_KEY: '',
      RESEND_FROM: ''
    })
    expect(errors).toContain('RESEND_API_KEY and RESEND_FROM are required for production account recovery')
  })

  it('requires a separate secret for visitor return links', () => {
    const errors = productionConfigErrors({ ...validEnvironment, VISITOR_REPLY_SECRET: 'short' })
    expect(errors).toContain('VISITOR_REPLY_SECRET must be a non-placeholder secret of at least 32 characters')
  })

  it('allows HTTP only for an exact local development origin', () => {
    expect(normalizeLaunchOrigin('http://localhost:2222', true)).toBe('http://localhost:2222')
    expect(normalizeLaunchOrigin('http://localhost:2222/path', true)).toBeNull()
    expect(normalizeLaunchOrigin('https://user:pass@useperch.xyz')).toBeNull()
  })
})
