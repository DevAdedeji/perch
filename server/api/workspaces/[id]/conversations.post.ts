import { and, eq, visitors } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  visitor_ref: z.string().uuid(),
  message: z.string().trim().min(1).max(4000)
})

/**
 * Start a conversation with a visitor from the live roster (agent reaches out
 * first). Reuses the visitor's active thread if one exists — see
 * `startAgentConversation`.
 */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { member } = await requireMembership(event, workspaceId)
  assertRateLimit('convo-start:member', member.id, { max: 30, windowMs: 60 * 1000 })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input' })
  }
  const { visitor_ref, message } = result.data

  const visitor = await useDb().query.visitors.findFirst({
    where: and(eq(visitors.id, visitor_ref), eq(visitors.workspaceId, workspaceId))
  })
  if (!visitor) {
    throw createError({ statusCode: 404, statusMessage: 'Visitor not found' })
  }

  const { conversation } = await startAgentConversation({
    workspaceId,
    visitorRef: visitor.id,
    memberId: member.id,
    content: message
  })

  setResponseStatus(event, 201)
  return { conversation_id: conversation.id }
})
