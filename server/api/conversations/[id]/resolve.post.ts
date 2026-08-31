export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  const { member } = await requireConversationMember(event, conversationId)
  const conversation = await setConversationStatus(conversationId, 'resolved', member.id)
  return { conversation: serializeConversation(conversation!) }
})
