import { and, automationNotifications, conversations, desc, eq, isNull } from '@perch/db'

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { member } = await requireMembership(event, workspaceId)
  const rows = await useDb().select({
    id: automationNotifications.id,
    conversationId: automationNotifications.conversationId,
    createdAt: automationNotifications.createdAt
  }).from(automationNotifications).innerJoin(
    conversations,
    eq(conversations.id, automationNotifications.conversationId)
  ).where(and(
    eq(automationNotifications.workspaceId, workspaceId),
    eq(automationNotifications.memberId, member.id),
    isNull(automationNotifications.readAt),
    eq(conversations.status, 'open'),
    eq(conversations.assignedAgentId, member.id)
  )).orderBy(desc(automationNotifications.createdAt)).limit(50)
  return rows.map(row => ({
    id: row.id,
    conversation_id: row.conversationId,
    created_at: row.createdAt.toISOString()
  }))
})
