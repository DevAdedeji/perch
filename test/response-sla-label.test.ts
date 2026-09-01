import { describe, expect, it } from 'vitest'
import type { ResponseSlaDTO } from '@perch/shared/models'
import { responseSlaLabel } from '../app/utils/response-sla'

function waitingSla(overrides: Partial<ResponseSlaDTO> = {}): ResponseSlaDTO {
  return {
    status: 'due',
    target_minutes: 15,
    started_at: '2026-09-01T10:00:00.000Z',
    approaching_at: '2026-09-01T10:11:15.000Z',
    due_at: '2026-09-01T10:15:00.000Z',
    paused_until: null,
    ...overrides
  }
}

describe('response SLA label', () => {
  it('never displays more time than the configured response target', () => {
    const slightlyStaleClientClock = new Date('2026-09-01T09:59:20.000Z')

    expect(responseSlaLabel(waitingSla(), slightlyStaleClientClock)).toBe('15m left')
  })

  it('does not cap how late a breached response is', () => {
    const fortyMinutesLate = new Date('2026-09-01T10:55:00.000Z')

    expect(responseSlaLabel(waitingSla({ status: 'breached' }), fortyMinutesLate)).toBe('40m late')
  })
})
