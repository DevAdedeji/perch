import { desc, eq, teamMessages, users, workspaceMembers } from '@perch/db'

/** The team lounge thread — last 100 messages, oldest first. Agents only, by nature. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId)

  const rows = await useDb()
    .select({
      id: teamMessages.id,
      clientMessageId: teamMessages.clientMessageId,
      memberId: teamMessages.memberId,
      memberName: users.name,
      content: teamMessages.content,
      mentionedMemberIds: teamMessages.mentionedMemberIds,
      createdAt: teamMessages.createdAt
    })
    .from(teamMessages)
    .innerJoin(workspaceMembers, eq(workspaceMembers.id, teamMessages.memberId))
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(teamMessages.workspaceId, workspaceId))
    .orderBy(desc(teamMessages.createdAt))
    .limit(100)

  return rows.reverse().map(r => ({
    id: r.id,
    client_message_id: r.clientMessageId,
    member_id: r.memberId,
    member_name: r.memberName,
    content: r.content,
    mentioned_member_ids: r.mentionedMemberIds,
    created_at: r.createdAt.toISOString()
  }))
})
