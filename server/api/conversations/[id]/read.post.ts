import { conversationReads } from '@perch/db'
import { channels } from '@perch/shared'

/** Mark a conversation read for the current agent (updates unread state). */
export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  const { member, conversation } = await requireConversationMember(event, conversationId)

  const db = useDb()
  const now = new Date()
  await db.insert(conversationReads)
    .values({ conversationId, memberId: member.id, lastReadAt: now })
    .onConflictDoUpdate({
      target: [conversationReads.conversationId, conversationReads.memberId],
      set: { lastReadAt: now }
    })

  // the visitor's widget shows "Seen" off this
  publishConversationEvent(channels.conversation(conversationId), {
    type: 'conversation.read',
    payload: { conversation_id: conversationId, last_read_at: now.toISOString() }
  }, conversation.assignedAgentId, conversation.collaboratorMemberIds)

  return { ok: true }
})
