export const NOTIFICATION_CATEGORIES = [
  'assignment',
  'mention',
  'unanswered_reminder'
] as const

export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number]

export interface NotificationPreference {
  category: NotificationCategory
  in_app_enabled: boolean
  browser_enabled: boolean
  email_enabled: boolean
}

export function defaultNotificationPreference(category: NotificationCategory): NotificationPreference {
  return {
    category,
    in_app_enabled: true,
    browser_enabled: false,
    email_enabled: category === 'unanswered_reminder'
  }
}

export function defaultNotificationPreferences(): NotificationPreference[] {
  return NOTIFICATION_CATEGORIES.map(defaultNotificationPreference)
}
