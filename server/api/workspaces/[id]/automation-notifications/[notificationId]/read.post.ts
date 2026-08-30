import { and, automationNotifications, eq } from '@perch/db'

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const notificationId = getRouterParam(event, 'notificationId')!
  const { member } = await requireMembership(event, workspaceId)
  const [updated] = await useDb().update(automationNotifications).set({ readAt: new Date() }).where(and(
    eq(automationNotifications.id, notificationId),
    eq(automationNotifications.workspaceId, workspaceId),
    eq(automationNotifications.memberId, member.id)
  )).returning({ id: automationNotifications.id })
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Reminder not found' })
  return { ok: true }
})
