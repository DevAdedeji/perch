import { and, eq, inArray, memberNotifications, teamMessages, workspaceMembers } from '@perch/db'
import { channels } from '@perch/shared'
import { z } from 'zod'

/** Say something in the team lounge — broadcast to every online teammate. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { user, member } = await requireMembership(event, workspaceId)
  assertRateLimit('team-chat:member', member.id, { max: 30, windowMs: 60 * 1000 })

  const result = await readValidatedBody(event, body => z.object({
    content: z.string().trim().min(1, 'Say something').max(2000),
    mentioned_member_ids: z.array(z.string().uuid()).max(10).optional()
  }).safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid input' })
  }

  const requestedMentionIds = [...new Set(result.data.mentioned_member_ids ?? [])]
    .filter(id => id !== member.id)
  const { row, notifications } = await useDb().transaction(async (tx) => {
    const targets = requestedMentionIds.length
      ? await tx.select({ id: workspaceMembers.id }).from(workspaceMembers).where(and(
          eq(workspaceMembers.workspaceId, workspaceId),
          inArray(workspaceMembers.id, requestedMentionIds)
        ))
      : []
    const mentionRecipientIds = targets.map(target => target.id)
    const [row] = await tx.insert(teamMessages).values({
      workspaceId,
      memberId: member.id,
      content: result.data.content,
      mentionedMemberIds: mentionRecipientIds
    }).returning()
    const notifications = row && mentionRecipientIds.length
      ? await tx.insert(memberNotifications).values(mentionRecipientIds.map(recipientMemberId => ({
          workspaceId,
          recipientMemberId,
          actorMemberId: member.id,
          actorName: user.name,
          type: 'mention' as const,
          source: 'nest' as const,
          teamMessageId: row.id,
          excerpt: row.content.slice(0, 160)
        }))).returning()
      : []
    return { row: row!, notifications }
  })

  const payload = {
    id: row!.id,
    workspace_id: workspaceId,
    member_id: member.id,
    member_name: user.name,
    content: row!.content,
    mentioned_member_ids: row!.mentionedMemberIds,
    created_at: row!.createdAt.toISOString()
  }
  // the workspace channel is already agents-only — visitors can never join it
  publish(channels.workspace(workspaceId), { type: 'team.message', payload })
  notifications.forEach(publishMemberNotification)

  setResponseStatus(event, 201)
  return payload
})
