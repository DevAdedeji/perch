export const SUPPORT_ANALYTICS_RANGES = {
  '7d': 7,
  '30d': 30,
  '90d': 90
} as const

export type SupportAnalyticsRange = keyof typeof SUPPORT_ANALYTICS_RANGES

export interface SupportAnalyticsWindow {
  key: SupportAnalyticsRange
  days: number
  start: Date
  end: Date
}

export function resolveSupportAnalyticsWindow(
  value: unknown,
  now = new Date()
): SupportAnalyticsWindow | null {
  if (typeof value !== 'string' || !(value in SUPPORT_ANALYTICS_RANGES)) return null

  const key = value as SupportAnalyticsRange
  const days = SUPPORT_ANALYTICS_RANGES[key]
  return {
    key,
    days,
    start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    end: new Date(now)
  }
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
