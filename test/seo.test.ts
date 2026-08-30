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
    expect(PERCH_ROBOTS_DISALLOWED_PATHS).toContain('/installation')
    expect(PERCH_ROBOTS_DISALLOWED_PATHS).not.toContain('/login')
  })
})
