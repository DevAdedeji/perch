import {
  and,
  auditLogs,
  conversations,
  eq,
  inArray,
  isNull,
  ne,
  visitorBlocks,
  visitors,
  workspaceMembers
} from '@perch/db'
import { channels } from '@perch/shared'

/** Restore a spam conversation and unblock only when no other spam record still protects the workspace. */
export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  const user = await requireUser(event)
  assertRateLimit('spam-control:member', user.id, { max: 20, windowMs: 60_000 })

  const db = useDb()
  const result = await db.transaction(async (tx) => {
    const [conversation] = await tx.select().from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update')
    if (!conversation) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })

    const member = await tx.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, conversation.workspaceId),
        eq(workspaceMembers.userId, user.id)
      )
    })
    if (!member || !canMemberAccessConversation(member, conversation)) {
      throw createError({ statusCode: 403, statusMessage: 'You cannot manage this conversation' })
    }

    const [visitor] = await tx.select().from(visitors)
      .where(and(eq(visitors.id, conversation.visitorRef), eq(visitors.workspaceId, conversation.workspaceId)))
      .for('update')
    if (!visitor) throw createError({ statusCode: 404, statusMessage: 'Visitor not found' })

    const now = new Date()
    let updated = conversation
    if (conversation.isSpam) {
      const [changed] = await tx.update(conversations).set({
        isSpam: false,
        spamMarkedAt: null,
        spamMarkedByMemberId: null,
        updatedAt: now
      }).where(eq(conversations.id, conversation.id)).returning()
      updated = changed!
    }

    const visitorIds = await linkedVisitorIds(tx, visitor)
    const otherSpam = visitorIds.length
      ? await tx.query.conversations.findFirst({
          where: and(
            eq(conversations.workspaceId, conversation.workspaceId),
            inArray(conversations.visitorRef, visitorIds),
            eq(conversations.isSpam, true),
            ne(conversations.id, conversation.id)
          ),
          columns: { id: true }
        })
      : null

    let unblocked = false
    if (!otherSpam && visitorIds.length) {
      const released = await tx.update(visitorBlocks).set({
        unblockedAt: now,
        unblockedByMemberId: member.id
      }).where(and(
        eq(visitorBlocks.workspaceId, conversation.workspaceId),
        inArray(visitorBlocks.visitorRef, visitorIds),
        isNull(visitorBlocks.unblockedAt)
      )).returning({ id: visitorBlocks.id })
      unblocked = released.length > 0
    }

    if (conversation.isSpam || unblocked) {
      await tx.insert(auditLogs).values({
        workspaceId: conversation.workspaceId,
        actorId: user.id,
        actorName: user.name,
        action: 'conversation.spam_restored',
        detail: {
          conversation_id: conversation.id,
          visitor_ref: visitor.id,
          visitor_unblocked: unblocked,
          visitor_still_blocked: !!otherSpam
        }
      })
    }

    return {
      conversation: updated,
      visitorIds,
      changed: conversation.isSpam || unblocked,
      visitorBlocked: !!otherSpam || (!unblocked && await isVisitorMessagingBlocked(visitor, tx))
    }
  })

  if (result.changed) {
    publishConversationUpdate(result.conversation)
    publishFiltered(channels.workspace(result.conversation.workspaceId), {
      type: 'conversation.refresh',
      payload: { conversation_id: result.conversation.id }
    }, inboxScope(result.conversation.assignedAgentId, result.conversation.collaboratorMemberIds))
  }
  if (!result.visitorBlocked) {
    for (const visitorId of result.visitorIds) {
      sendToVisitor(result.conversation.workspaceId, visitorId, {
        type: 'visitor.messaging',
        payload: { available: true }
      })
    }
  }

  return {
    conversation: serializeConversation(result.conversation),
    visitor_blocked: result.visitorBlocked
  }
})
