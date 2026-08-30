import { describe, expect, it } from 'vitest'
import {
  PERCH_INDEXABLE_PATHS,
  PERCH_PRODUCTION_ORIGIN,
  PERCH_ROBOTS_DISALLOWED_PATHS,
  isPerchIndexablePath,
  isPerchProductionOrigin
} from '@perch/shared'

describe('SEO boundaries', () => {
  it('indexes only intentional public pages', () => {
    expect(PERCH_INDEXABLE_PATHS).toEqual(['/', '/privacy', '/terms'])
    expect(isPerchIndexablePath('/')).toBe(true)
    expect(isPerchIndexablePath('/help/ws_18c6715c14')).toBe(true)
    expect(isPerchIndexablePath('/help/ws_18c6715c14/550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(isPerchIndexablePath('/help/not-a-site')).toBe(false)
    expect(isPerchIndexablePath('/help/ws_18c6715c14/not-an-article')).toBe(false)
    expect(isPerchIndexablePath('/dashboard')).toBe(false)
    expect(isPerchIndexablePath('/login')).toBe(false)
    expect(isPerchIndexablePath('/join/private-token')).toBe(false)
  })

  it('recognizes only the canonical production origin as indexable', () => {
    expect(isPerchProductionOrigin(PERCH_PRODUCTION_ORIGIN)).toBe(true)
    expect(isPerchProductionOrigin('https://www.useperch.xyz')).toBe(false)
    expect(isPerchProductionOrigin('https://staging.useperch.xyz')).toBe(false)
    expect(isPerchProductionOrigin('http://localhost:2222')).toBe(false)
  })

  it('keeps private application surfaces out of crawler discovery', () => {
    expect(PERCH_ROBOTS_DISALLOWED_PATHS).toContain('/api/')
    expect(PERCH_ROBOTS_DISALLOWED_PATHS).toContain('/admin/')
    expect(PERCH_ROBOTS_DISALLOWED_PATHS).toContain('/dashboard')
    expect(PERCH_ROBOTS_DISALLOWED_PATHS).not.toContain('/login')
  })
})
