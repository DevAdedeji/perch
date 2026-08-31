import { describe, expect, it } from 'vitest'
import {
  evaluateInstallationSignal,
  InstallationSignalDebouncer,
  INSTALLATION_SIGNAL_WRITE_DEBOUNCE_MS,
  MAX_INSTALLATION_PAGES_PER_WORKSPACE,
  MAX_NEW_INSTALLATION_PAGES_PER_HOUR,
  installationPageForOrigin,
  installationPageHash,
  installationPageMatches,
  normalizeInstallationPage,
  observedEmbedOrigin
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

  it('binds reported pages to the server-observed embed origin', () => {
    expect(observedEmbedOrigin('https://Customer.Example/pricing', undefined)).toBe('https://customer.example')
    expect(observedEmbedOrigin(undefined, 'https://customer.example')).toBe('https://customer.example')
    expect(observedEmbedOrigin('https://customer.example', 'https://spoofed.example')).toBeNull()
    expect(installationPageForOrigin('https://customer.example/pricing', 'https://customer.example'))
      .toMatchObject({ url: 'https://customer.example/pricing' })
    expect(installationPageForOrigin('https://spoofed.example/pricing', 'https://customer.example')).toBeNull()
  })
})

describe('installation signal write debouncing', () => {
  it('keeps concurrent pages independent while suppressing duplicate page writes', () => {
    const debouncer = new InstallationSignalDebouncer()
    const pricing = installationPageHash('https://customer.example/pricing')
    const contact = installationPageHash('https://customer.example/contact')

    expect(debouncer.shouldWrite('workspace-1', pricing, 1_000)).toBe(true)
    expect(debouncer.shouldWrite('workspace-1', contact, 1_000)).toBe(true)
    expect(debouncer.shouldWrite('workspace-1', pricing, 2_000)).toBe(false)
    expect(debouncer.shouldWrite('workspace-1', pricing, 1_000 + INSTALLATION_SIGNAL_WRITE_DEBOUNCE_MS)).toBe(true)
  })

  it('keeps the durable observation set and new-page budget bounded', () => {
    expect(MAX_INSTALLATION_PAGES_PER_WORKSPACE).toBe(100)
    expect(MAX_NEW_INSTALLATION_PAGES_PER_HOUR).toBeLessThan(MAX_INSTALLATION_PAGES_PER_WORKSPACE)
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
