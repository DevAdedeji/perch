import { describe, expect, it } from 'vitest'
import {
  isMissedSupportConversation,
  resolveSupportAnalyticsWindow,
  supportAnalyticsMissedCutoff,
  toFiniteNumber,
  toNullableFiniteNumber
} from '../server/utils/support-analytics'

describe('support analytics range', () => {
  const now = new Date('2026-08-30T01:30:00.000Z')

  it.each([
    ['7d', 7, '2026-08-23'],
    ['30d', 30, '2026-07-31'],
    ['90d', 90, '2026-06-01']
  ])('resolves %s to exactly that many local calendar buckets', (key, days, expectedStart) => {
    expect(resolveSupportAnalyticsWindow(key, 'America/Los_Angeles', now)).toEqual({
      key,
      days,
      startDay: expectedStart,
      endDayExclusive: '2026-08-30'
    })
  })

  it('uses the workspace local day when UTC has already moved to tomorrow', () => {
    expect(resolveSupportAnalyticsWindow('7d', 'Pacific/Honolulu', new Date('2026-08-30T05:00:00.000Z')))
      .toMatchObject({ startDay: '2026-08-23', endDayExclusive: '2026-08-30' })
  })

  it('rejects unsupported and non-string ranges', () => {
    expect(resolveSupportAnalyticsWindow('365d', 'UTC', now)).toBeNull()
    expect(resolveSupportAnalyticsWindow(undefined, 'UTC', now)).toBeNull()
    expect(resolveSupportAnalyticsWindow(30, 'UTC', now)).toBeNull()
  })
})

describe('missed conversation threshold', () => {
  const now = new Date('2026-08-30T12:00:00.000Z')

  it('uses the first unanswered visitor message and a 15-minute cutoff', () => {
    expect(supportAnalyticsMissedCutoff(now)).toEqual(new Date('2026-08-30T11:45:00.000Z'))
    expect(isMissedSupportConversation(new Date('2026-08-30T11:44:00.000Z'), null, false, now)).toBe(true)
    expect(isMissedSupportConversation(new Date('2026-08-30T11:46:00.000Z'), null, false, now)).toBe(false)
  })

  it('does not count answered or resolved conversations as missed', () => {
    const firstVisitorAt = new Date('2026-08-30T11:00:00.000Z')
    expect(isMissedSupportConversation(firstVisitorAt, new Date('2026-08-30T11:05:00.000Z'), false, now)).toBe(false)
    expect(isMissedSupportConversation(firstVisitorAt, null, true, now)).toBe(false)
    expect(isMissedSupportConversation(null, null, false, now)).toBe(false)
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
