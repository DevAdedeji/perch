import { describe, expect, it } from 'vitest'
import { isDomainAllowed, normalizeDomain } from '../server/utils/domains'

describe('normalizeDomain', () => {
  it('lowercases and strips www', () => {
    expect(normalizeDomain('Example.COM')).toBe('example.com')
    expect(normalizeDomain('www.example.com')).toBe('example.com')
  })

  it('tolerates pasted URLs', () => {
    expect(normalizeDomain('https://App.Example.com/pricing?x=1')).toBe('app.example.com')
    expect(normalizeDomain('http://example.com:3000')).toBe('example.com')
  })

  it('rejects things that are not domains', () => {
    expect(normalizeDomain('')).toBeNull()
    expect(normalizeDomain('not a domain')).toBeNull()
    expect(normalizeDomain('nodots')).toBeNull()
    expect(normalizeDomain('-bad.com')).toBeNull()
  })

  it('allows localhost for development', () => {
    expect(normalizeDomain('localhost')).toBe('localhost')
  })
})

describe('isDomainAllowed', () => {
  const allowed = ['example.com', 'adedeji.xyz']

  it('allows everything when no list is configured', () => {
    expect(isDomainAllowed('https://anywhere.io/page', [])).toBe(true)
    expect(isDomainAllowed(null, [])).toBe(true)
  })

  it('allows exact hosts, www, and subdomains', () => {
    expect(isDomainAllowed('https://example.com/', allowed)).toBe(true)
    expect(isDomainAllowed('https://www.example.com/', allowed)).toBe(true)
    expect(isDomainAllowed('https://app.example.com/dash', allowed)).toBe(true)
    expect(isDomainAllowed('https://perch.adedeji.xyz/', allowed)).toBe(true)
  })

  it('blocks other hosts — including suffix look-alikes', () => {
    expect(isDomainAllowed('https://stranger.io/', allowed)).toBe(false)
    // "evilexample.com" ends with "example.com" as a string but is NOT a subdomain
    expect(isDomainAllowed('https://evilexample.com/', allowed)).toBe(false)
  })

  it('fails closed when a list exists but the page URL is missing or invalid', () => {
    expect(isDomainAllowed(null, allowed)).toBe(false)
    expect(isDomainAllowed(undefined, allowed)).toBe(false)
    expect(isDomainAllowed('not a url', allowed)).toBe(false)
  })
})
