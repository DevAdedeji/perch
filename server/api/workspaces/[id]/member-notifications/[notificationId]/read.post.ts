import { and, eq, memberNotifications } from '@perch/db'

/** Acknowledge one notification; ownership is enforced in the update itself. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const notificationId = getRouterParam(event, 'notificationId')!
  const { member } = await requireMembership(event, workspaceId)

  const [updated] = await useDb().update(memberNotifications).set({ readAt: new Date() }).where(and(
    eq(memberNotifications.id, notificationId),
    eq(memberNotifications.workspaceId, workspaceId),
    eq(memberNotifications.recipientMemberId, member.id)
  )).returning({ id: memberNotifications.id })

  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Notification not found' })
  return { ok: true }
})
