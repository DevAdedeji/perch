import { describe, expect, it } from 'vitest'
import { calculateResponseSla, effectiveResponseTargetMinutes } from '../server/utils/response-sla'

const now = new Date('2026-09-01T10:15:00.000Z')

describe('response SLA state', () => {
  it('uses the fixed Free target while allowing Pro customization', () => {
    expect(effectiveResponseTargetMinutes(5, false)).toBe(15)
    expect(effectiveResponseTargetMinutes(5, true)).toBe(5)
  })

  it('starts due and becomes approaching in the final quarter', () => {
    expect(calculateResponseSla({
      conversationStatus: 'unassigned',
      latestVisitorAt: new Date('2026-09-01T10:10:00.000Z'),
      targetMinutes: 20,
      now
    }).status).toBe('due')

    const approaching = calculateResponseSla({
      conversationStatus: 'open',
      latestVisitorAt: new Date('2026-09-01T10:00:00.000Z'),
      targetMinutes: 20,
      now
    })
    expect(approaching.status).toBe('approaching')
    expect(approaching.due_at).toBe('2026-09-01T10:20:00.000Z')
  })

  it('is breached exactly at the response deadline', () => {
    expect(calculateResponseSla({
      conversationStatus: 'open',
      latestVisitorAt: new Date('2026-09-01T10:00:00.000Z'),
      targetMinutes: 15,
      now
    }).status).toBe('breached')
  })

  it('is answered only by a public agent response after the latest visitor message', () => {
    expect(calculateResponseSla({
      conversationStatus: 'open',
      latestVisitorAt: new Date('2026-09-01T10:10:00.000Z'),
      latestAgentAt: new Date('2026-09-01T10:11:00.000Z'),
      targetMinutes: 15,
      now
    }).status).toBe('answered')

    expect(calculateResponseSla({
      conversationStatus: 'open',
      latestVisitorAt: new Date('2026-09-01T10:10:00.000Z'),
      latestAgentAt: new Date('2026-09-01T10:09:00.000Z'),
      targetMinutes: 15,
      now
    }).status).toBe('due')
  })

  it('pauses the inbox warning while a conversation is snoozed without resetting its deadline', () => {
    const result = calculateResponseSla({
      conversationStatus: 'open',
      snoozedUntil: new Date('2026-09-01T11:00:00.000Z'),
      latestVisitorAt: new Date('2026-09-01T09:00:00.000Z'),
      targetMinutes: 15,
      now
    })
    expect(result.status).toBe('paused')
    expect(result.due_at).toBe('2026-09-01T09:15:00.000Z')
    expect(result.paused_until).toBe('2026-09-01T11:00:00.000Z')
  })

  it('does not flag resolved conversations or conversations without visitor messages', () => {
    expect(calculateResponseSla({
      conversationStatus: 'resolved',
      latestVisitorAt: new Date('2026-09-01T09:00:00.000Z'),
      targetMinutes: 15,
      now
    }).status).toBe('answered')
    expect(calculateResponseSla({ conversationStatus: 'open', targetMinutes: 15, now }).status).toBe('answered')
  })
})
