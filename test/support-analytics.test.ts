import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
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

describe('immutable support outcomes', () => {
  const analyticsSource = readFileSync(new URL('../server/api/workspaces/[id]/analytics.get.ts', import.meta.url), 'utf8')
  const teamQuery = analyticsSource.slice(analyticsSource.indexOf('db.execute<MemberRow>'))
  const conversationsSource = readFileSync(new URL('../server/utils/conversations.ts', import.meta.url), 'utf8')
  const automationsSource = readFileSync(new URL('../server/utils/automation-engine.ts', import.meta.url), 'utf8')
  const resolveSource = readFileSync(new URL('../server/api/conversations/[id]/resolve.post.ts', import.meta.url), 'utf8')
  const csatSource = readFileSync(new URL('../server/api/widget/csat.post.ts', import.meta.url), 'utf8')
  const widgetSource = readFileSync(new URL('../app/composables/useWidget.ts', import.meta.url), 'utf8')
  const schemaSource = readFileSync(new URL('../packages/db/src/schema.ts', import.meta.url), 'utf8')
  const migrationSource = readFileSync(
    new URL('../packages/db/migrations/0020_immutable-support-outcomes.sql', import.meta.url),
    'utf8'
  )

  it('aggregates member metrics once instead of running per-member count subqueries', () => {
    expect(teamQuery).toContain('agent_activity as')
    expect(teamQuery).toContain('resolution_metrics as')
    expect(teamQuery).toContain('csat_metrics as')
    expect(teamQuery).not.toMatch(/\(\s*select count\(/)
  })

  it('records the authenticated resolver exactly once per state transition', () => {
    expect(resolveSource).toContain(`setConversationStatus(conversationId, 'resolved', member.id)`)
    expect(conversationsSource).toContain('tx.insert(supportOutcomeEvents)')
    expect(conversationsSource).toContain(`ne(conversations.status, 'resolved')`)
    expect(conversationsSource).toContain(`eventType: 'resolution'`)
    expect(conversationsSource).toContain('actorMemberId: actorMemberId!')
  })

  it('records automatic resolutions without attributing them to a person', () => {
    const autoCloseSource = automationsSource.slice(automationsSource.indexOf('async function runAutoClose'))
    expect(autoCloseSource).toContain('tx.insert(supportOutcomeEvents)')
    expect(autoCloseSource).toContain(`eventType: 'resolution'`)
    expect(autoCloseSource).not.toContain('actorMemberId:')
  })

  it('appends CSAT history while preserving separate current conversation state', () => {
    expect(csatSource).toContain('.set({ csatRating: rating, csatComment: comment || null, csatAt: now })')
    expect(csatSource).toContain(`eventType: 'csat'`)
    expect(csatSource).toContain('actorMemberId: resolution?.actorMemberId ?? null')
    expect(csatSource).toContain('tx.insert(supportOutcomeEvents)')
  })

  it('serializes, rate-limits, caps, and deduplicates CSAT revisions', () => {
    expect(csatSource).toContain(`request_id: z.string().uuid()`)
    expect(csatSource).toContain(`.for('update')`)
    expect(csatSource).toContain(`'widget-csat:visitor'`)
    expect(csatSource).toContain(`'widget-csat:workspace'`)
    expect(csatSource).toContain('>= 10')
    expect(csatSource.indexOf(`.for('update')`)).toBeLessThan(csatSource.indexOf('const now = new Date()'))
    expect(widgetSource).toContain('crypto.randomUUID()')
    expect(widgetSource).toContain('request_id: pendingCsat.requestId')
  })

  it('reads historical outcomes only from append-only events', () => {
    expect(analyticsSource).toContain('from ${supportOutcomeEvents} e')
    expect(analyticsSource).toContain('latest_csat_events as')
    expect(analyticsSource).toContain('order by e.conversation_id, e.occurred_at desc, e.id desc')
    expect(analyticsSource).not.toMatch(/c\.(resolved_at|csat_at|csat_rating)/)
    expect(teamQuery).not.toContain('c.assigned_agent_id = wm.id')
  })

  it('defines indexes for workspace reporting and per-conversation CSAT lookup', () => {
    expect(schemaSource).toContain('support_outcome_events_workspace_type_time_idx')
    expect(schemaSource).toContain('.on(t.workspaceId, t.eventType, t.occurredAt)')
    expect(schemaSource).toContain('support_outcome_events_conversation_type_time_idx')
    expect(schemaSource).toContain('.on(t.conversationId, t.eventType, t.occurredAt)')
    expect(schemaSource).toContain('support_outcome_events_conversation_request_uq')
    expect(schemaSource).toContain('messages_public_conversation_sender_time_idx')
    expect(schemaSource).toContain('messages_public_sender_time_conversation_idx')
  })

  it('backfills the recoverable resolution and CSAT history for existing conversations', () => {
    expect(migrationSource).toContain('COALESCE(c."resolved_at", c."csat_at")')
    expect(migrationSource).not.toContain('c."assigned_agent_id"')
    expect(migrationSource).toContain('NULL,')
    expect(migrationSource).toContain(`c."csat_rating" IN ('good', 'bad')`)
    expect(migrationSource).toContain('support_outcome_events_workspace_type_time_idx')
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
