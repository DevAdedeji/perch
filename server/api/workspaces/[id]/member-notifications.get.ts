import { and, desc, eq, isNull, memberNotifications } from '@perch/db'

/** Unread assignment and mention notifications for the current workspace member. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { member } = await requireMembership(event, workspaceId)

  const rows = await useDb().query.memberNotifications.findMany({
    where: and(
      eq(memberNotifications.workspaceId, workspaceId),
      eq(memberNotifications.recipientMemberId, member.id),
      isNull(memberNotifications.readAt)
    ),
    orderBy: [desc(memberNotifications.createdAt)],
    limit: 50
  })

  return rows.map(serializeMemberNotification)
})
