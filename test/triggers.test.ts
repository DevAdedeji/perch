import { describe, expect, it } from 'vitest'
import { matchesTriggerUrl } from '../server/utils/triggers'

describe('matchesTriggerUrl', () => {
  it('matches a substring of the URL', () => {
    expect(matchesTriggerUrl('/pricing', 'https://acme.com/pricing')).toBe(true)
    expect(matchesTriggerUrl('/pricing', 'https://acme.com/about')).toBe(false)
  })

  it('is case-insensitive on both sides', () => {
    expect(matchesTriggerUrl('/Pricing', 'https://acme.com/pricing?ref=x')).toBe(true)
    expect(matchesTriggerUrl('/pricing', 'https://acme.com/PRICING')).toBe(true)
  })

  it('empty or blank pattern matches every page', () => {
    expect(matchesTriggerUrl('', 'https://acme.com/anything')).toBe(true)
    expect(matchesTriggerUrl('   ', 'https://acme.com/anything')).toBe(true)
  })

  it('matches against the full URL including host and query', () => {
    expect(matchesTriggerUrl('acme.com', 'https://acme.com/')).toBe(true)
    expect(matchesTriggerUrl('utm_source=ad', 'https://acme.com/?utm_source=ad')).toBe(true)
  })

  it('does not treat the pattern as a regex', () => {
    expect(matchesTriggerUrl('.*', 'https://acme.com/pricing')).toBe(false)
  })
})
