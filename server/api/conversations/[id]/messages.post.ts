import { z } from 'zod'

const bodySchema = z.object({
  content: z.string().trim().min(1, 'Message is empty').max(5000),
  is_internal_note: z.boolean().optional()
})

/** Agent reply (or internal note) to a conversation. */
export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  const { member, conversation } = await requireConversationMember(event, conversationId)

  const result = await readValidatedBody(event, body => bodySchema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input', data: result.error.flatten() })
  }

  const message = await addAgentMessage({
    conversationId,
    workspaceId: conversation.workspaceId,
    senderMemberId: member.id,
    content: result.data.content,
    isInternalNote: result.data.is_internal_note
  })

  setResponseStatus(event, 201)
  return { message: serializeMessage(message) }
})
