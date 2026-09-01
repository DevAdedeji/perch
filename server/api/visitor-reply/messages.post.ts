import { z } from 'zod'

const schema = z.object({ content: z.string().trim().min(1).max(5000) })

export default defineEventHandler(async (event) => {
  assertRateLimit('visitor-reply-message:ip', requestIp(event), { max: 60, windowMs: 60_000 })
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) throw createError({ statusCode: 400, statusMessage: 'Write a message before sending' })
  const { conversation, visitor, workspace } = await requireReplyContinuation(event)
  assertRateLimit('visitor-reply-message:visitor', visitor.id, { max: 20, windowMs: 60_000 })
  if (await isVisitorMessagingBlocked(visitor)) {
    throw createError({ statusCode: 403, statusMessage: 'Messaging is not available for this conversation' })
  }

  const created = await ingestVisitorMessage({
    workspaceId: workspace.id,
    visitorId: visitor.visitorId,
    conversationId: conversation.id,
    content: result.data.content
  })
  setResponseStatus(event, 201)
  return { message: serializeVisitorMessage(created.message) }
})
