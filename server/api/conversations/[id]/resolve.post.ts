export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  await requireConversationMember(event, conversationId)
  const conversation = await setConversationStatus(conversationId, 'resolved')
  return { conversation: serializeConversation(conversation!) }
})
