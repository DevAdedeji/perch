import { describe, expect, it } from 'vitest'
import { PERCH_PRODUCTION_ORIGIN } from '@perch/shared'
import { normalizePublicOrigin } from '../server/utils/email'

describe('production configuration', () => {
  it('uses the current canonical public origin', () => {
    expect(PERCH_PRODUCTION_ORIGIN).toBe('https://useperch.xyz')
    expect(new URL(PERCH_PRODUCTION_ORIGIN).protocol).toBe('https:')
  })

  it('only permits secure production link origins', () => {
    expect(normalizePublicOrigin('https://useperch.xyz/path', false)).toBe('https://useperch.xyz')
    expect(normalizePublicOrigin('http://useperch.xyz', false)).toBeNull()
    expect(normalizePublicOrigin('javascript:alert(1)', false)).toBeNull()
    expect(normalizePublicOrigin('https://user:password@useperch.xyz', false)).toBeNull()
  })

  it('permits HTTP only for local development', () => {
    expect(normalizePublicOrigin('http://localhost:2222/path', true)).toBe('http://localhost:2222')
  })
})
