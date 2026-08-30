import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  isMissedSupportConversation,
  resolveSupportAnalyticsWindow,
  supportOutcomeOwner,
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

describe('historical team outcome attribution', () => {
  const resolvedAt = new Date('2026-08-30T12:00:00.000Z')
  const messages = [
    {
      senderId: 'agent-a',
      senderType: 'agent' as const,
      isInternalNote: false,
      createdAt: new Date('2026-08-30T11:00:00.000Z')
    },
    {
      senderId: 'agent-b',
      senderType: 'agent' as const,
      isInternalNote: false,
      createdAt: new Date('2026-08-30T11:55:00.000Z')
    },
    {
      senderId: 'agent-c',
      senderType: 'agent' as const,
      isInternalNote: false,
      createdAt: new Date('2026-08-30T12:05:00.000Z')
    }
  ]

  it('attributes an outcome to the last public agent reply before it occurred', () => {
    expect(supportOutcomeOwner(messages, resolvedAt)).toBe('agent-b')
  })

  it('does not depend on the conversation current assignee', () => {
    const ownerBeforeReassignment = supportOutcomeOwner(messages, resolvedAt)
    const currentAssigneeAfterReassignment = 'agent-c'
    expect(ownerBeforeReassignment).toBe('agent-b')
    expect(ownerBeforeReassignment).not.toBe(currentAssigneeAfterReassignment)
  })

  it('ignores internal notes and visitor messages', () => {
    expect(supportOutcomeOwner([
      { ...messages[0]!, isInternalNote: true },
      { ...messages[1]!, senderType: 'visitor' }
    ], resolvedAt)).toBeNull()
  })
})

describe('team analytics query shape', () => {
  const source = readFileSync(new URL('../server/api/workspaces/[id]/analytics.get.ts', import.meta.url), 'utf8')
  const teamQuery = source.slice(source.indexOf('db.execute<MemberRow>'))

  it('aggregates member metrics once instead of running per-member count subqueries', () => {
    expect(teamQuery).toContain('agent_activity as')
    expect(teamQuery).toContain('resolution_metrics as')
    expect(teamQuery).toContain('csat_metrics as')
    expect(teamQuery).not.toMatch(/\(\s*select count\(/)
  })

  it('derives historical outcomes from immutable message timing, not current assignment', () => {
    expect(teamQuery).toContain('m.created_at <= c.resolved_at')
    expect(teamQuery).toContain('m.created_at <= c.csat_at')
    expect(teamQuery).not.toContain('c.assigned_agent_id = wm.id')
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
