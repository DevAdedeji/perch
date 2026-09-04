import { and, desc, eq, messages, visitorConversationReads } from '@perch/db'

export default defineEventHandler(async (event) => {
  const { conversation, visitor, workspace } = await requireReplyContinuation(event)
  assertRateLimit('visitor-reply-session:visitor', visitor.id, { max: 60, windowMs: 60_000 })
  const rows = await useDb().query.messages.findMany({
    where: and(eq(messages.conversationId, conversation.id), eq(messages.isInternalNote, false)),
    orderBy: desc(messages.createdAt),
    limit: 100
  })
  const thread = rows.reverse()
  const latestAgent = [...thread].reverse().find(message => message.senderType === 'agent')
  if (latestAgent) {
    await useDb().insert(visitorConversationReads).values({
      conversationId: conversation.id,
      visitorRef: visitor.id,
      lastMessageId: latestAgent.id,
      readAt: new Date()
    }).onConflictDoUpdate({
      target: visitorConversationReads.conversationId,
      set: { lastMessageId: latestAgent.id, readAt: new Date() }
    })
  }
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return {
    workspace: {
      name: workspace.name,
      logo_url: workspace.logoUrl,
      color: workspace.widgetPrimaryColor
    },
    visitor: { name: visitor.name },
    conversation: { id: conversation.id, status: conversation.status },
    messages: thread.map(serializeVisitorMessage)
  }
})
