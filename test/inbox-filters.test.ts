import { describe, expect, it } from 'vitest'
import {
  conversationOrganizationSchema,
  parseInboxFilters,
  savedInboxFiltersSchema,
  validateSnoozeDate
} from '../server/utils/inbox-filters'

describe('inbox filters', () => {
  it('uses safe defaults for the ordinary inbox', () => {
    const result = parseInboxFilters({})
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).toEqual({
      status: undefined,
      assignee: 'any',
      priorities: [],
      tagIds: [],
      snoozed: 'exclude',
      response: 'all',
      spam: 'exclude'
    })
  })

  it('normalizes comma-separated priorities and tag ids without duplicates', () => {
    const tag = '32e0cb65-3800-4e9b-b05d-d1f4cd20b414'
    const result = parseInboxFilters({ priority: 'urgent,high,urgent', tag: `${tag},${tag}`, assignee: 'me', snoozed: 'only' })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.priorities).toEqual(['urgent', 'high'])
    expect(result.data.tagIds).toEqual([tag])
    expect(result.data.snoozed).toBe('only')
    expect(parseInboxFilters({ response: 'breached' }).success).toBe(true)
  })

  it('rejects unknown filter values and malformed ids', () => {
    expect(parseInboxFilters({ priority: 'critical' }).success).toBe(false)
    expect(parseInboxFilters({ tag: 'not-a-uuid' }).success).toBe(false)
    expect(parseInboxFilters({ assignee: 'someone' }).success).toBe(false)
    expect(parseInboxFilters({ response: 'late' }).success).toBe(false)
  })

  it('validates saved views strictly', () => {
    const valid = {
      status: 'open',
      assignee: 'me',
      priorities: ['high'],
      tag_ids: [],
      snoozed: 'exclude'
    }
    expect(savedInboxFiltersSchema.safeParse(valid).success).toBe(true)
    expect(savedInboxFiltersSchema.safeParse({ ...valid, hidden: true }).success).toBe(false)
  })
})

describe('conversation organization', () => {
  it('requires an actual change', () => {
    expect(conversationOrganizationSchema.safeParse({}).success).toBe(false)
    expect(conversationOrganizationSchema.safeParse({ priority: 'urgent' }).success).toBe(true)
    expect(conversationOrganizationSchema.safeParse({ snoozed_until: null }).success).toBe(true)
  })

  it('accepts only future snoozes within one year', () => {
    const now = new Date('2026-08-30T12:00:00.000Z')
    expect(validateSnoozeDate(new Date('2026-08-30T11:59:59.000Z'), now)).toBe('Snooze time must be in the future')
    expect(validateSnoozeDate(new Date('2027-08-31T12:00:00.000Z'), now)).toBe('Snooze time cannot be more than one year away')
    expect(validateSnoozeDate(new Date('2026-08-31T12:00:00.000Z'), now)).toBeNull()
    expect(validateSnoozeDate(null, now)).toBeNull()
  })
})
