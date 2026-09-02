import { channels } from '@perch/shared'

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { user, member } = await requireMembership(event, workspaceId)
  assertRateLimit('bulk-conversation-action', member.id, { max: 20, windowMs: 60_000 })

  const parsed = await readValidatedBody(event, body => bulkConversationActionSchema.safeParse(body))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid bulk action', data: parsed.error.flatten() })
  }

  const result = await mutateConversationsInBulk(useDb(), workspaceId, {
    userId: user.id,
    memberId: member.id,
    name: user.name
  }, parsed.data)

  for (const change of result.assignmentChanges) {
    publishConversationUpdate(change.conversation, { previousAssignedAgentId: change.previousAssignedAgentId })
  }
  if (parsed.data.action === 'resolve' || parsed.data.action === 'reopen') {
    for (const conversation of result.conversations) {
      if (result.changedConversationIds.includes(conversation.id)) publishConversationUpdate(conversation)
    }
  }
  if (parsed.data.action === 'add_tag' || parsed.data.action === 'remove_tag') {
    for (const conversation of result.conversations) {
      if (!result.changedConversationIds.includes(conversation.id)) continue
      const refresh = { type: 'conversation.refresh' as const, payload: { conversation_id: conversation.id } }
      publishFiltered(channels.workspace(workspaceId),
        refresh,
        inboxScope(workspaceId, conversation.assignedAgentId, conversation.collaboratorMemberIds)
      )
      publishConversationEvent(
        workspaceId,
        conversation.id,
        refresh,
        conversation.assignedAgentId,
        conversation.collaboratorMemberIds,
        { agentsOnly: true }
      )
    }
  }
  for (const notification of result.notifications) publishMemberNotification(notification)
  for (const conversation of result.newlyResolved) {
    dispatchWebhooks(workspaceId, 'conversation.resolved', { conversation: serializeConversation(conversation) })
  }

  logAudit(workspaceId, user, `conversation.bulk.${parsed.data.action}`, {
    requested_count: result.requestedCount,
    changed_count: result.changedConversationIds.length,
    conversation_ids: parsed.data.conversation_ids.slice(0, 10),
    additional_count: Math.max(0, parsed.data.conversation_ids.length - 10),
    ...('member_id' in parsed.data ? { target_member_id: parsed.data.member_id } : {}),
    ...('tag_id' in parsed.data ? { tag_id: parsed.data.tag_id } : {})
  })

  return {
    action: result.action,
    requested_count: result.requestedCount,
    changed_count: result.changedConversationIds.length,
    unchanged_count: result.requestedCount - result.changedConversationIds.length
  }
})
