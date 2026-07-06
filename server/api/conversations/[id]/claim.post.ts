/** Claim an unassigned conversation — first writer wins (§6.4). */
export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  const { member, conversation } = await requireConversationMember(event, conversationId)

  const result = await claimConversation(conversationId, conversation.workspaceId, member.id)

  if (result.ok) {
    return { ok: true, conversation: serializeConversation(result.conversation!) }
  }

  // lost the race — surface the current owner to the losing agent
  setResponseStatus(event, 409)
  return { ok: false, assignedAgentId: result.assignedAgentId }
})
