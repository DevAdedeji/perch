import { and, conversations, eq, messages, visitorConversationReads } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  site_id: z.string().min(1).max(128),
  visitor_session: z.string().min(1).max(2048),
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid()
})

export default defineEventHandler(async (event) => {
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) throw createError({ statusCode: 400, statusMessage: 'Invalid input' })
  const { visitor } = await requireVisitorSession(event, result.data.site_id, result.data.visitor_session)
  assertRateLimit('widget-read:visitor', visitor.id, { max: 60, windowMs: 60_000 })

  await useDb().transaction(async (tx) => {
    const [conversation] = await tx.select({ id: conversations.id }).from(conversations).where(and(
      eq(conversations.id, result.data.conversation_id),
      eq(conversations.visitorRef, visitor.id)
    )).limit(1)
    if (!conversation) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })

    const [message] = await tx.select({ id: messages.id, createdAt: messages.createdAt }).from(messages).where(and(
      eq(messages.id, result.data.message_id),
      eq(messages.conversationId, conversation.id),
      eq(messages.senderType, 'agent'),
      eq(messages.isInternalNote, false)
    )).limit(1)
    if (!message) throw createError({ statusCode: 400, statusMessage: 'Message cannot be marked read' })

    const [existing] = await tx.select().from(visitorConversationReads)
      .where(eq(visitorConversationReads.conversationId, conversation.id)).for('update')
    if (existing) {
      const [previous] = await tx.select({ createdAt: messages.createdAt }).from(messages)
        .where(eq(messages.id, existing.lastMessageId)).limit(1)
      if (previous && previous.createdAt.getTime() > message.createdAt.getTime()) return
      await tx.update(visitorConversationReads).set({
        lastMessageId: message.id,
        readAt: new Date()
      }).where(eq(visitorConversationReads.conversationId, conversation.id))
    } else {
      await tx.insert(visitorConversationReads).values({
        conversationId: conversation.id,
        visitorRef: visitor.id,
        lastMessageId: message.id
      })
    }
  })

  return { ok: true }
})
