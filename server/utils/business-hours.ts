import type { BusinessDay, BusinessHours } from '@perch/shared'

const DAYS: BusinessDay[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_LABELS: Record<BusinessDay, string> = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday'
}

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** The workspace-local day + "HH:MM" for an instant, DST handled by Intl. */
function localParts(tz: string, now: Date): { day: BusinessDay, time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  const day = get('weekday').slice(0, 3).toLowerCase() as BusinessDay
  // Intl can emit "24:xx" for midnight in some environments
  const hour = get('hour') === '24' ? '00' : get('hour')
  return { day, time: `${hour}:${get('minute')}` }
}

/**
 * Is the workspace inside its scheduled hours right now?
 * No schedule (or no timezone) = always available — today's behavior.
 */
export function isWithinBusinessHours(
  hours: BusinessHours | null | undefined,
  tz: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!hours || !tz || !isValidTimezone(tz)) return true
  const { day, time } = localParts(tz, now)
  const range = hours[day]
  if (!range) return false
  return time >= range.open && time < range.close
}

/** "h:MM AM" from "HH:MM" — friendlier than 24h in visitor-facing copy. */
function friendlyTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(m).padStart(2, '0')} ${suffix}`
}

/**
 * Visitor-facing label for the next opening: "back today at 2 PM",
 * "back tomorrow at 9 AM", "back Monday at 9 AM". Null when no schedule
 * applies (always-on workspaces) or nothing is open in the next week.
 */
export function nextOpeningLabel(
  hours: BusinessHours | null | undefined,
  tz: string | null | undefined,
  now: Date = new Date()
): string | null {
  if (!hours || !tz || !isValidTimezone(tz)) return null
  const { day, time } = localParts(tz, now)
  const todayIdx = DAYS.indexOf(day)

  for (let offset = 0; offset < 7; offset++) {
    const d = DAYS[(todayIdx + offset) % 7]!
    const range = hours[d]
    if (!range) continue
    if (offset === 0 && time >= range.open) continue // today's window already started (or passed)
    const when = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : DAY_LABELS[d]
    return `back ${when} at ${friendlyTime(range.open)}`
  }
  // wrapped a full week: today's slot is next week's
  const range = hours[day]
  if (range) return `back ${DAY_LABELS[day]} at ${friendlyTime(range.open)}`
  return null
}
