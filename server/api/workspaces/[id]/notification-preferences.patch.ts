import { notificationPreferences, sql } from '@perch/db'
import { notificationPreferenceUpdateSchema } from '../../../utils/notification-preference-validation'

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { member } = await requireMembership(event, workspaceId)
  assertRateLimit('notification-preferences:member', member.id, { max: 20, windowMs: 60_000 })

  const result = await readValidatedBody(event, body => notificationPreferenceUpdateSchema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid preferences' })
  }

  await useDb().transaction(async (tx) => {
    for (const preference of result.data.preferences) {
      await tx.insert(notificationPreferences).values({
        memberId: member.id,
        category: preference.category,
        inAppEnabled: preference.in_app_enabled,
        browserEnabled: preference.browser_enabled,
        emailEnabled: preference.email_enabled
      }).onConflictDoUpdate({
        target: [notificationPreferences.memberId, notificationPreferences.category],
        set: {
          inAppEnabled: preference.in_app_enabled,
          browserEnabled: preference.browser_enabled,
          emailEnabled: preference.email_enabled,
          updatedAt: sql`now()`
        }
      })
    }
  })

  return { preferences: await memberNotificationPreferences(member.id) }
})
