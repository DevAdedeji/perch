import { and, conversations, eq, visitors, workspaces } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  site_id: z.string().min(1),
  visitor_id: z.string().min(8).max(128),
  conversation_id: z.string().uuid(),
  rating: z.enum(['good', 'bad']),
  comment: z.string().trim().max(500).optional()
})

/**
 * Post-resolve CSAT from the widget. Overwritable while the widget shows the
 * prompt (people mis-tap); only the visitor who owns the conversation can rate.
 */
export default defineEventHandler(async (event) => {
  assertRateLimit('widget-csat:ip', requestIp(event), { max: 10, windowMs: 60 * 1000 })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input' })
  }
  const { site_id, visitor_id, conversation_id, rating, comment } = result.data

  const db = useDb()
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.siteId, site_id) })
  if (!workspace) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown site' })
  }
  const visitor = await db.query.visitors.findFirst({
    where: and(eq(visitors.workspaceId, workspace.id), eq(visitors.visitorId, visitor_id))
  })
  const conversation = visitor
    ? await db.query.conversations.findFirst({
        where: and(eq(conversations.id, conversation_id), eq(conversations.visitorRef, visitor.id))
      })
    : null
  if (!conversation) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  }
  if (conversation.status !== 'resolved') {
    throw createError({ statusCode: 400, statusMessage: 'Only resolved conversations can be rated' })
  }

  await db.update(conversations)
    .set({ csatRating: rating, csatComment: comment || null, csatAt: new Date() })
    .where(eq(conversations.id, conversation.id))

  return { ok: true, rating }
})
