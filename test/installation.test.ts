import { describe, expect, it } from 'vitest'
import {
  evaluateInstallationSignal,
  installationPageMatches,
  normalizeInstallationPage
} from '../server/utils/installation'

describe('installation page normalization', () => {
  it('keeps the public origin and path while dropping query strings and fragments', () => {
    expect(normalizeInstallationPage('https://Example.com/pricing?campaign=launch#chat')).toEqual({
      url: 'https://example.com/pricing',
      origin: 'https://example.com',
      pathname: '/pricing'
    })
  })

  it.each([
    '',
    'not a URL',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:password@example.com'
  ])('rejects invalid or non-web page %s', (value) => {
    expect(normalizeInstallationPage(value)).toBeNull()
  })

  it('matches the exact host and page instead of reporting a different route as installed', () => {
    const requested = normalizeInstallationPage('https://example.com/pricing')!
    expect(installationPageMatches(requested, normalizeInstallationPage('https://example.com/pricing?x=1')!)).toBe(true)
    expect(installationPageMatches(requested, normalizeInstallationPage('https://example.com/')!)).toBe(false)
    expect(installationPageMatches(requested, normalizeInstallationPage('https://shop.example.com/pricing')!)).toBe(false)
  })
})

describe('installation runtime signal', () => {
  const requested = normalizeInstallationPage('https://example.com/pricing')!
  const now = new Date('2026-08-30T12:00:00.000Z')

  it('accepts a matching signal observed within the last 15 minutes', () => {
    expect(evaluateInstallationSignal(
      requested,
      'https://example.com/pricing',
      '2026-08-30T11:50:00.000Z',
      now
    )).toMatchObject({ installed: true, reason: 'installed' })
  })

  it('makes stale and different-page results explicit', () => {
    expect(evaluateInstallationSignal(
      requested,
      'https://example.com/pricing',
      '2026-08-30T11:30:00.000Z',
      now
    )).toMatchObject({ installed: false, reason: 'stale' })
    expect(evaluateInstallationSignal(
      requested,
      'https://example.com/',
      '2026-08-30T11:59:00.000Z',
      now
    )).toMatchObject({ installed: false, reason: 'different_page' })
  })

  it('does not trust an incomplete signal', () => {
    expect(evaluateInstallationSignal(requested, null, null, now))
      .toMatchObject({ installed: false, reason: 'not_seen' })
  })
})
