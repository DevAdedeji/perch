import { and, conversations, desc, eq, supportOutcomeEvents } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  site_id: z.string().min(1),
  visitor_session: z.string().min(1).max(2048),
  conversation_id: z.string().uuid(),
  rating: z.enum(['good', 'bad']),
  comment: z.string().trim().max(500).optional()
})

/** Post-resolve CSAT from the visitor who owns the conversation. */
export default defineEventHandler(async (event) => {
  assertRateLimit('widget-csat:ip', requestIp(event), { max: 10, windowMs: 60 * 1000 })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input' })
  }
  const { site_id, visitor_session, conversation_id, rating, comment } = result.data

  const db = useDb()
  const { visitor } = await requireVisitorSession(event, site_id, visitor_session)
  await db.transaction(async (tx) => {
    const now = new Date()
    const [conversation] = await tx.update(conversations)
      .set({ csatRating: rating, csatComment: comment || null, csatAt: now })
      .where(and(
        eq(conversations.id, conversation_id),
        eq(conversations.visitorRef, visitor.id),
        eq(conversations.status, 'resolved')
      ))
      .returning()

    if (!conversation) {
      const existing = await tx.query.conversations.findFirst({
        columns: { status: true },
        where: and(eq(conversations.id, conversation_id), eq(conversations.visitorRef, visitor.id))
      })
      if (!existing) {
        throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
      }
      throw createError({ statusCode: 400, statusMessage: 'Only resolved conversations can be rated' })
    }

    const resolution = await tx.query.supportOutcomeEvents.findFirst({
      columns: { actorMemberId: true },
      where: and(
        eq(supportOutcomeEvents.conversationId, conversation.id),
        eq(supportOutcomeEvents.eventType, 'resolution')
      ),
      orderBy: [desc(supportOutcomeEvents.occurredAt), desc(supportOutcomeEvents.id)]
    })

    await tx.insert(supportOutcomeEvents).values({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      eventType: 'csat',
      actorMemberId: resolution?.actorMemberId ?? null,
      rating,
      occurredAt: now
    })
  })

  return { ok: true, rating }
})
