import { NOTIFICATION_CATEGORIES } from '@perch/shared'
import { z } from 'zod'

const preferenceSchema = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES),
  in_app_enabled: z.boolean(),
  browser_enabled: z.boolean(),
  email_enabled: z.boolean()
}).refine(row => row.category === 'unanswered_reminder' || !row.email_enabled, {
  message: 'Email delivery is only available for unanswered-message reminders',
  path: ['email_enabled']
})

export const notificationPreferenceUpdateSchema = z.object({
  preferences: z.array(preferenceSchema).length(NOTIFICATION_CATEGORIES.length)
    .refine(rows => new Set(rows.map(row => row.category)).size === NOTIFICATION_CATEGORIES.length, {
      message: 'Send one preference for each notification type'
    })
})
