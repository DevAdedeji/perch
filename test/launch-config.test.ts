import { describe, expect, it } from 'vitest'
import {
  assertProductionConfig,
  BACHS_RECURRING_RESPONSE_CONTRACT_VERIFIED,
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
  BACHS_ENV: 'sandbox',
  BACHS_SECRET_KEY: 'sk_sandbox_example',
  BACHS_WEBHOOK_SECRET: 'whsec_example',
  PERCH_BILLING_CHECKOUT_ENABLED: 'false',
  VISITOR_REPLY_EMAIL_FEATURE_ENABLED: 'false',
  VISITOR_REPLY_EMAIL_DELIVERY_ENABLED: 'false'
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
      BACHS_ENV: '',
      BACHS_SECRET_KEY: privateValue,
      BACHS_WEBHOOK_SECRET: '',
      NUXT_OAUTH_GOOGLE_CLIENT_ID: 'client-id',
      CLOUDINARY_CLOUD_NAME: 'perch'
    })
    const output = errors.join('\n')

    expect(output).toContain('BACHS_ENV, BACHS_SECRET_KEY, BACHS_WEBHOOK_SECRET')
    expect(output).toContain('NUXT_OAUTH_GOOGLE_CLIENT_ID')
    expect(output).toContain('CLOUDINARY_CLOUD_NAME')
    expect(output).not.toContain(privateValue)
  })

  it('requires an explicit Bachs environment matching the key', () => {
    expect(productionConfigErrors({ ...validEnvironment, BACHS_ENV: 'live' })).toContain(
      'BACHS_ENV must match the Bachs secret-key environment'
    )
    expect(productionConfigErrors({ ...validEnvironment, BACHS_ENV: 'preview' })).toContain('BACHS_ENV must be sandbox or live')
  })

  it('allows explicit sandbox verification but keeps live checkout fail-closed', () => {
    expect(productionConfigErrors({
      ...validEnvironment,
      PERCH_BILLING_CHECKOUT_ENABLED: 'sometimes'
    })).toContain('PERCH_BILLING_CHECKOUT_ENABLED must be true or false')

    const completeProviderErrors = productionConfigErrors({
      ...validEnvironment,
      PERCH_BILLING_CHECKOUT_ENABLED: 'true'
    })
    expect(BACHS_RECURRING_RESPONSE_CONTRACT_VERIFIED).toBe(false)
    expect(completeProviderErrors).toEqual([])

    expect(productionConfigErrors({
      ...validEnvironment,
      BACHS_ENV: 'live',
      BACHS_SECRET_KEY: 'sk_live_example',
      PERCH_BILLING_CHECKOUT_ENABLED: 'true'
    })).toContain('Live Bachs checkout requires an authoritative recurring-response contract')

    expect(productionConfigErrors({
      ...validEnvironment,
      PERCH_BILLING_CHECKOUT_ENABLED: 'true',
      BACHS_ENV: '',
      BACHS_SECRET_KEY: '',
      BACHS_WEBHOOK_SECRET: ''
    })).toContain('PERCH_BILLING_CHECKOUT_ENABLED=true requires complete Bachs configuration')
  })

  it('requires transactional email for production account recovery', () => {
    const errors = productionConfigErrors({
      ...validEnvironment,
      RESEND_API_KEY: '',
      RESEND_FROM: ''
    })
    expect(errors).toContain('RESEND_API_KEY and RESEND_FROM are required for production account recovery')
  })

  it('rejects the local webhook escape hatch in production', () => {
    expect(productionConfigErrors({
      ...validEnvironment,
      PERCH_WEBHOOK_ALLOW_LOCALHOST: 'true'
    })).toContain('PERCH_WEBHOOK_ALLOW_LOCALHOST must not be enabled in production')
  })

  it('does not require visitor email secrets while the feature is disabled', () => {
    expect(productionConfigErrors({
      ...validEnvironment,
      VISITOR_REPLY_SECRET: '',
      VISITOR_EMAIL_HASH_SECRET: ''
    })).toEqual([])
  })

  it('requires independent strong link and email-hash secrets when the feature is exposed', () => {
    const errors = productionConfigErrors({
      ...validEnvironment,
      VISITOR_REPLY_EMAIL_FEATURE_ENABLED: 'true',
      VISITOR_REPLY_SECRET: 'short',
      VISITOR_EMAIL_HASH_SECRET: 'short'
    })
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('VISITOR_REPLY_SECRET'),
      expect.stringContaining('VISITOR_EMAIL_HASH_SECRET')
    ]))

    expect(productionConfigErrors({
      ...validEnvironment,
      VISITOR_REPLY_EMAIL_FEATURE_ENABLED: 'true',
      VISITOR_REPLY_SECRET: 'visitor-reply-secret-unique-849201',
      VISITOR_EMAIL_HASH_SECRET: 'visitor-email-hash-secret-unique-572940'
    })).toEqual([])
  })

  it('requires a strong Resend webhook secret before visitor reply delivery is enabled', () => {
    const errors = productionConfigErrors({
      ...validEnvironment,
      VISITOR_REPLY_EMAIL_FEATURE_ENABLED: 'true',
      VISITOR_REPLY_EMAIL_DELIVERY_ENABLED: 'true',
      VISITOR_REPLY_SECRET: 'strong-reply-link-secret-value-849201',
      VISITOR_EMAIL_HASH_SECRET: 'strong-email-hash-secret-value-572940',
      RESEND_WEBHOOK_SECRET: 'short'
    })
    expect(errors).toContain(
      'RESEND_WEBHOOK_SECRET must be a non-placeholder secret of at least 32 characters when visitor reply email delivery is enabled'
    )

    expect(productionConfigErrors({
      ...validEnvironment,
      VISITOR_REPLY_EMAIL_FEATURE_ENABLED: 'true',
      VISITOR_REPLY_EMAIL_DELIVERY_ENABLED: 'true',
      VISITOR_REPLY_SECRET: 'strong-reply-link-secret-value-849201',
      VISITOR_EMAIL_HASH_SECRET: 'strong-email-hash-secret-value-572940',
      RESEND_WEBHOOK_SECRET: 'whsec_strong-resend-webhook-secret-638105'
    })).toEqual([])
  })

  it('does not allow delivery to be enabled while feature exposure is off', () => {
    const errors = productionConfigErrors({
      ...validEnvironment,
      VISITOR_REPLY_EMAIL_DELIVERY_ENABLED: 'true'
    })
    expect(errors).toContain('VISITOR_REPLY_EMAIL_DELIVERY_ENABLED requires VISITOR_REPLY_EMAIL_FEATURE_ENABLED=true')
  })

  it('allows HTTP only for an exact local development origin', () => {
    expect(normalizeLaunchOrigin('http://localhost:2222', true)).toBe('http://localhost:2222')
    expect(normalizeLaunchOrigin('http://localhost:2222/path', true)).toBeNull()
    expect(normalizeLaunchOrigin('https://user:pass@useperch.xyz')).toBeNull()
  })
})
