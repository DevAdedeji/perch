import type { ResponseSlaDTO, ResponseSlaStatus } from '@perch/shared'

export function currentResponseSlaStatus(sla: ResponseSlaDTO, now = new Date()): ResponseSlaStatus {
  if (sla.status === 'answered' || sla.status === 'paused' || !sla.due_at || !sla.approaching_at) return sla.status
  const time = now.getTime()
  if (time >= new Date(sla.due_at).getTime()) return 'breached'
  if (time >= new Date(sla.approaching_at).getTime()) return 'approaching'
  return 'due'
}

export function responseSlaLabel(sla: ResponseSlaDTO, now = new Date()): string {
  const status = currentResponseSlaStatus(sla, now)
  if (status === 'answered') return 'Replied'
  if (status === 'paused') return 'Paused'
  if (!sla.due_at) return 'Replied'

  const rawSeconds = Math.max(0, Math.round(Math.abs(new Date(sla.due_at).getTime() - now.getTime()) / 1000))
  const seconds = status === 'breached'
    ? rawSeconds
    : Math.min(rawSeconds, Math.max(60, sla.target_minutes * 60))
  const duration = seconds < 60
    ? '<1m'
    : seconds < 3600
      ? `${Math.ceil(seconds / 60)}m`
      : `${Math.ceil(seconds / 3600)}h`
  return status === 'breached' ? `${duration} late` : `${duration} left`
}
