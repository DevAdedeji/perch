import {
  and,
  auditLogs,
  conversations,
  eq,
  inArray,
  isNull,
  visitorBlocks,
  visitors,
  workspaceMembers
} from '@perch/db'
import { channels } from '@perch/shared'

/** Mark one conversation as spam and block that visitor from messaging this workspace. */
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

    const visitorIds = await linkedVisitorIds(tx, visitor)
    const activeBlock = visitorIds.length
      ? await tx.query.visitorBlocks.findFirst({
          where: and(
            eq(visitorBlocks.workspaceId, conversation.workspaceId),
            inArray(visitorBlocks.visitorRef, visitorIds),
            isNull(visitorBlocks.unblockedAt)
          ),
          columns: { id: true }
        })
      : null

    const now = new Date()
    let updated = conversation
    if (!conversation.isSpam) {
      const [changed] = await tx.update(conversations).set({
        isSpam: true,
        spamMarkedAt: now,
        spamMarkedByMemberId: member.id,
        status: 'resolved',
        resolvedAt: conversation.resolvedAt ?? now,
        snoozedUntil: null,
        updatedAt: now
      }).where(eq(conversations.id, conversation.id)).returning()
      updated = changed!
    }

    let blockCreated = false
    if (!activeBlock) {
      await tx.insert(visitorBlocks).values({
        workspaceId: conversation.workspaceId,
        visitorRef: visitor.id,
        sourceConversationId: conversation.id,
        blockedByMemberId: member.id,
        blockedAt: now
      })
      blockCreated = true
    }

    if (!conversation.isSpam || blockCreated) {
      await tx.insert(auditLogs).values({
        workspaceId: conversation.workspaceId,
        actorId: user.id,
        actorName: user.name,
        action: 'conversation.spam_marked',
        detail: {
          conversation_id: conversation.id,
          visitor_ref: visitor.id,
          visitor_block_created: blockCreated,
          block_scope: visitor.identityVerified && visitor.externalId ? 'verified_identity' : 'browser_session'
        }
      })
    }

    return {
      conversation: updated,
      visitorIds,
      changed: !conversation.isSpam || blockCreated
    }
  })

  if (result.changed) {
    publishConversationUpdate(result.conversation)
    publishFiltered(channels.workspace(result.conversation.workspaceId), {
      type: 'conversation.refresh',
      payload: { conversation_id: result.conversation.id }
    }, inboxScope(result.conversation.assignedAgentId, result.conversation.collaboratorMemberIds))
  }
  for (const visitorId of result.visitorIds) {
    sendToVisitor(result.conversation.workspaceId, visitorId, {
      type: 'visitor.messaging',
      payload: { available: false }
    })
  }

  return {
    conversation: serializeConversation(result.conversation),
    visitor_blocked: true
  }
})
