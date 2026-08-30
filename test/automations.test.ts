import { describe, expect, it } from 'vitest'
import { inactivityExecutionKey, reminderExecutionKey, roundRobinIndex } from '../server/utils/automation-engine'
import { matchesPageRule, matchesVipRule, parseAutomationConfig } from '../server/utils/automation-rules'

describe('automation rule validation', () => {
  it('accepts each launch template with safe ranges', () => {
    expect(parseAutomationConfig('round_robin', { member_ids: [] }).success).toBe(true)
    expect(parseAutomationConfig('page_assignment', {
      url_contains: '/pricing', member_id: '32e0cb65-3800-4e9b-b05d-d1f4cd20b414'
    }).success).toBe(true)
    expect(parseAutomationConfig('vip_tagging', {
      condition: 'email_domain', value: 'example.com', tag_id: '32e0cb65-3800-4e9b-b05d-d1f4cd20b414'
    }).success).toBe(true)
    expect(parseAutomationConfig('inactivity_reminder', { minutes: 30 }).success).toBe(true)
    expect(parseAutomationConfig('auto_close', { hours: 72 }).success).toBe(true)
  })

  it('rejects unsafe automatic-close windows and unknown metadata', () => {
    expect(parseAutomationConfig('auto_close', { hours: 2 }).success).toBe(false)
    expect(parseAutomationConfig('inactivity_reminder', { minutes: 1 }).success).toBe(false)
    expect(parseAutomationConfig('vip_tagging', {
      condition: 'metadata', metadata_key: 'password', value: 'x', tag_id: '32e0cb65-3800-4e9b-b05d-d1f4cd20b414'
    }).success).toBe(false)
    expect(parseAutomationConfig('vip_tagging', {
      condition: 'metadata', metadata_key: 'browser', value: 'Safari', tag_id: '32e0cb65-3800-4e9b-b05d-d1f4cd20b414'
    }).success).toBe(false)
  })
})

describe('automation matching', () => {
  const visitor = (overrides: Record<string, unknown> = {}) => ({
    email: null,
    identityVerified: false,
    metadata: {},
    ...overrides
  }) as Parameters<typeof matchesVipRule>[1]

  it('matches page routes case-insensitively', () => {
    expect(matchesPageRule({ url_contains: '/Pricing' }, 'https://example.com/pricing?plan=pro')).toBe(true)
    expect(matchesPageRule({ url_contains: '/pricing' }, 'https://example.com/about')).toBe(false)
    expect(matchesPageRule({ url_contains: '/pricing' }, undefined)).toBe(false)
  })

  it('only trusts verified identity for VIP email rules', () => {
    const rule = { condition: 'email_domain' as const, value: 'example.com', tag_id: 'tag' }
    expect(matchesVipRule(rule, visitor({ email: 'ada@example.com' }))).toBe(false)
    expect(matchesVipRule(rule, visitor({ email: 'ada@example.com', identityVerified: true }))).toBe(true)
    expect(matchesVipRule(rule, visitor({ email: 'ada@other.com', identityVerified: true }))).toBe(false)
  })

  it('matches only allowlisted visitor metadata fields', () => {
    const rule = { condition: 'metadata' as const, metadata_key: 'page_url' as const, value: '/enterprise', tag_id: 'tag' }
    expect(matchesVipRule(rule, visitor({ metadata: { page_url: 'https://example.com/enterprise' } }))).toBe(true)
    expect(matchesVipRule(rule, visitor({ metadata: { page_url: 'https://example.com/pricing' } }))).toBe(false)
  })
})

describe('automation idempotency helpers', () => {
  it('rotates predictably and rejects invalid inputs', () => {
    expect([1, 2, 3, 4, 5].map(cursor => roundRobinIndex(cursor, 3))).toEqual([0, 1, 2, 0, 1])
    expect(roundRobinIndex(0, 3)).toBeNull()
    expect(roundRobinIndex(1, 0)).toBeNull()
  })

  it('ties inactivity execution to the exact activity version', () => {
    const first = inactivityExecutionKey('rule', 'conversation', new Date('2026-08-30T10:00:00Z'))
    const retry = inactivityExecutionKey('rule', 'conversation', new Date('2026-08-30T10:00:00Z'))
    const afterReply = inactivityExecutionKey('rule', 'conversation', new Date('2026-08-30T10:01:00Z'))
    expect(retry).toBe(first)
    expect(afterReply).not.toBe(first)
  })

  it('reminds a new owner even when conversation activity has not changed', () => {
    const activity = new Date('2026-08-30T10:00:00Z')
    const firstOwner = reminderExecutionKey('rule', 'conversation', 'agent-a', activity)
    expect(reminderExecutionKey('rule', 'conversation', 'agent-a', activity)).toBe(firstOwner)
    expect(reminderExecutionKey('rule', 'conversation', 'agent-b', activity)).not.toBe(firstOwner)
  })
})
