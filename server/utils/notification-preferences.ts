import { and, eq, notificationPreferences } from '@perch/db'
import {
  defaultNotificationPreference,
  defaultNotificationPreferences,
  type NotificationCategory,
  type NotificationPreference
} from '@perch/shared'

export type NotificationChannel = 'in_app' | 'browser' | 'email'

export function mergeNotificationPreferences(rows: Array<typeof notificationPreferences.$inferSelect>): NotificationPreference[] {
  const saved = new Map(rows.map(row => [row.category, row]))
  return defaultNotificationPreferences().map((fallback) => {
    const row = saved.get(fallback.category)
    return row
      ? {
          category: row.category,
          in_app_enabled: row.inAppEnabled,
          browser_enabled: row.browserEnabled,
          email_enabled: row.emailEnabled
        }
      : fallback
  })
}

export async function memberNotificationPreferences(memberId: string): Promise<NotificationPreference[]> {
  const rows = await useDb().select().from(notificationPreferences)
    .where(eq(notificationPreferences.memberId, memberId))
  return mergeNotificationPreferences(rows)
}

export async function notificationChannelEnabled(
  memberId: string,
  category: NotificationCategory,
  channel: NotificationChannel
): Promise<boolean> {
  const [row] = await useDb().select().from(notificationPreferences).where(and(
    eq(notificationPreferences.memberId, memberId),
    eq(notificationPreferences.category, category)
  )).limit(1)
  const preference = row
    ? {
        category: row.category,
        in_app_enabled: row.inAppEnabled,
        browser_enabled: row.browserEnabled,
        email_enabled: row.emailEnabled
      }
    : defaultNotificationPreference(category)
  if (channel === 'in_app') return preference.in_app_enabled
  if (channel === 'browser') return preference.browser_enabled
  return preference.email_enabled
}
