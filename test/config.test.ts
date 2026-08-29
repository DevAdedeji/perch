import { describe, expect, it } from 'vitest'
import { PERCH_PRODUCTION_ORIGIN } from '@perch/shared'

describe('production configuration', () => {
  it('uses the current canonical public origin', () => {
    expect(PERCH_PRODUCTION_ORIGIN).toBe('https://useperch.xyz')
    expect(new URL(PERCH_PRODUCTION_ORIGIN).protocol).toBe('https:')
  })
})
