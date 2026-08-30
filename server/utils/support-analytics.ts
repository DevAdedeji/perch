export const SUPPORT_ANALYTICS_RANGES = {
  '7d': 7,
  '30d': 30,
  '90d': 90
} as const

export type SupportAnalyticsRange = keyof typeof SUPPORT_ANALYTICS_RANGES

export interface SupportAnalyticsWindow {
  key: SupportAnalyticsRange
  days: number
  startDay: string
  endDayExclusive: string
}

function localCalendarDay(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value)
  const valueFor = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
  return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`
}

function shiftCalendarDay(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10)
}

export function resolveSupportAnalyticsWindow(
  value: unknown,
  timezone = 'UTC',
  now = new Date()
): SupportAnalyticsWindow | null {
  if (typeof value !== 'string' || !(value in SUPPORT_ANALYTICS_RANGES)) return null

  const key = value as SupportAnalyticsRange
  const days = SUPPORT_ANALYTICS_RANGES[key]
  const currentDay = localCalendarDay(now, timezone)
  return {
    key,
    days,
    startDay: shiftCalendarDay(currentDay, -(days - 1)),
    endDayExclusive: shiftCalendarDay(currentDay, 1)
  }
}

export function supportAnalyticsMissedCutoff(now = new Date()): Date {
  return new Date(now.getTime() - 15 * 60 * 1000)
}

export function isMissedSupportConversation(
  firstVisitorAt: Date | null,
  firstAgentAt: Date | null,
  resolved: boolean,
  now = new Date()
): boolean {
  return !resolved
    && firstAgentAt === null
    && firstVisitorAt !== null
    && firstVisitorAt <= supportAnalyticsMissedCutoff(now)
}

export function toFiniteNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

export function toNullableFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
