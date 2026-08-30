import { conversations, eq } from '@perch/db'

export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  const { user, conversation } = await requireConversationMember(event, conversationId)
  const result = await readValidatedBody(event, body => conversationOrganizationSchema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid inbox update', data: result.error.flatten() })
  }
  const snoozeError = validateSnoozeDate(result.data.snoozed_until)
  if (snoozeError) throw createError({ statusCode: 400, statusMessage: snoozeError })

  const [updated] = await useDb().update(conversations).set({
    ...(result.data.priority !== undefined ? { priority: result.data.priority } : {}),
    ...(result.data.snoozed_until !== undefined ? { snoozedUntil: result.data.snoozed_until } : {}),
    updatedAt: new Date()
  }).where(eq(conversations.id, conversationId)).returning()
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })

  publishConversationUpdate(updated)
  logAudit(conversation.workspaceId, user, 'conversation.organized', {
    conversationId,
    priority: result.data.priority,
    snoozedUntil: result.data.snoozed_until?.toISOString() ?? result.data.snoozed_until
  })
  return { conversation: serializeConversation(updated) }
})
