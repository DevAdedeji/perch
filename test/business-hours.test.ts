import { describe, expect, it } from 'vitest'
import { isWithinBusinessHours, isValidTimezone, nextOpeningLabel } from '../server/utils/business-hours'
import type { BusinessHours } from '@perch/shared'

// Mon 9-17, Tue closed, Wed 9-17, weekend closed
const HOURS: BusinessHours = {
  mon: { open: '09:00', close: '17:00' },
  tue: null,
  wed: { open: '09:00', close: '17:00' },
  thu: { open: '09:00', close: '17:00' },
  fri: { open: '09:00', close: '13:00' }
}

// helpers: build instants at a UTC wall time (we test with tz=UTC for determinism)
const at = (iso: string) => new Date(iso)

describe('isWithinBusinessHours', () => {
  it('is always-on when there is no schedule or timezone', () => {
    expect(isWithinBusinessHours(null, 'UTC')).toBe(true)
    expect(isWithinBusinessHours(HOURS, null)).toBe(true)
    expect(isWithinBusinessHours(undefined, undefined)).toBe(true)
  })

  it('is open inside a scheduled window', () => {
    // 2026-07-13 is a Monday
    expect(isWithinBusinessHours(HOURS, 'UTC', at('2026-07-13T10:30:00Z'))).toBe(true)
  })

  it('is closed before opening and at/after closing', () => {
    expect(isWithinBusinessHours(HOURS, 'UTC', at('2026-07-13T08:59:00Z'))).toBe(false)
    expect(isWithinBusinessHours(HOURS, 'UTC', at('2026-07-13T17:00:00Z'))).toBe(false)
  })

  it('is closed on null days and unlisted days', () => {
    expect(isWithinBusinessHours(HOURS, 'UTC', at('2026-07-14T12:00:00Z'))).toBe(false) // Tue null
    expect(isWithinBusinessHours(HOURS, 'UTC', at('2026-07-18T12:00:00Z'))).toBe(false) // Sat absent
  })

  it('evaluates in the workspace timezone, not UTC', () => {
    // 08:00 UTC Monday = 09:00 in Lagos (UTC+1) → open there, closed in UTC
    expect(isWithinBusinessHours(HOURS, 'Africa/Lagos', at('2026-07-13T08:00:00Z'))).toBe(true)
    expect(isWithinBusinessHours(HOURS, 'UTC', at('2026-07-13T08:00:00Z'))).toBe(false)
  })

  it('treats an invalid timezone as always-on rather than erroring', () => {
    expect(isWithinBusinessHours(HOURS, 'Not/AZone', at('2026-07-14T12:00:00Z'))).toBe(true)
  })
})

describe('nextOpeningLabel', () => {
  it('is null for always-on workspaces', () => {
    expect(nextOpeningLabel(null, 'UTC')).toBeNull()
  })

  it('says today before opening time', () => {
    expect(nextOpeningLabel(HOURS, 'UTC', at('2026-07-13T06:00:00Z'))).toBe('back today at 9 AM')
  })

  it('skips closed days to the next open one', () => {
    // Monday evening → Tuesday is closed → Wednesday
    expect(nextOpeningLabel(HOURS, 'UTC', at('2026-07-13T18:00:00Z'))).toBe('back Wednesday at 9 AM')
  })

  it('says tomorrow when the next open day is adjacent', () => {
    // Wednesday evening → Thursday
    expect(nextOpeningLabel(HOURS, 'UTC', at('2026-07-15T18:00:00Z'))).toBe('back tomorrow at 9 AM')
  })

  it('wraps the week from Friday afternoon to Monday', () => {
    expect(nextOpeningLabel(HOURS, 'UTC', at('2026-07-17T14:00:00Z'))).toBe('back Monday at 9 AM')
  })

  it('formats half-hour openings', () => {
    const h: BusinessHours = { mon: { open: '09:30', close: '17:00' } }
    expect(nextOpeningLabel(h, 'UTC', at('2026-07-13T06:00:00Z'))).toBe('back today at 9:30 AM')
  })
})

describe('isValidTimezone', () => {
  it('accepts IANA zones and rejects junk', () => {
    expect(isValidTimezone('Africa/Lagos')).toBe(true)
    expect(isValidTimezone('America/New_York')).toBe(true)
    expect(isValidTimezone('Not/AZone')).toBe(false)
  })
})
