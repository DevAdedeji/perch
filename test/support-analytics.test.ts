import { describe, expect, it } from 'vitest'
import {
  resolveSupportAnalyticsWindow,
  toFiniteNumber,
  toNullableFiniteNumber
} from '../server/utils/support-analytics'

describe('support analytics range', () => {
  const now = new Date('2026-08-30T12:00:00.000Z')

  it.each([
    ['7d', 7, '2026-08-23T12:00:00.000Z'],
    ['30d', 30, '2026-07-31T12:00:00.000Z'],
    ['90d', 90, '2026-06-01T12:00:00.000Z']
  ])('resolves %s to a bounded reporting window', (key, days, expectedStart) => {
    expect(resolveSupportAnalyticsWindow(key, now)).toEqual({
      key,
      days,
      start: new Date(expectedStart),
      end: now
    })
  })

  it('rejects unsupported and non-string ranges', () => {
    expect(resolveSupportAnalyticsWindow('365d', now)).toBeNull()
    expect(resolveSupportAnalyticsWindow(undefined, now)).toBeNull()
    expect(resolveSupportAnalyticsWindow(30, now)).toBeNull()
  })
})

describe('analytics numeric normalization', () => {
  it('normalizes postgres numeric strings and invalid values', () => {
    expect(toFiniteNumber('12')).toBe(12)
    expect(toFiniteNumber(null)).toBe(0)
    expect(toFiniteNumber('not-a-number')).toBe(0)
  })

  it('preserves missing averages as null', () => {
    expect(toNullableFiniteNumber('19.5')).toBe(19.5)
    expect(toNullableFiniteNumber(null)).toBeNull()
    expect(toNullableFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull()
  })
})
