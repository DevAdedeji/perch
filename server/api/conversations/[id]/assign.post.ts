import { and, eq, workspaceMembers } from '@perch/db'
import { z } from 'zod'

const schema = z.object({ member_id: z.string().uuid() })

/** Transfer a conversation to another agent (§3.3). Any member may reassign. */
export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  const { conversation } = await requireConversationMember(event, conversationId)

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input' })
  }

  // the target must be a member of this conversation's workspace
  const target = await useDb().query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.id, result.data.member_id),
      eq(workspaceMembers.workspaceId, conversation.workspaceId)
    )
  })
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'That agent is not in this workspace' })
  }

  const updated = await assignConversation(conversationId, target.id)
  return { conversation: serializeConversation(updated!) }
})
