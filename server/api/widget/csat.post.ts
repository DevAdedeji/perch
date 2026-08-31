import { and, conversations, desc, eq, sql, supportOutcomeEvents } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  site_id: z.string().min(1),
  visitor_session: z.string().min(1).max(2048),
  conversation_id: z.string().uuid(),
  request_id: z.string().uuid(),
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
  const { site_id, visitor_session, conversation_id, request_id, rating, comment } = result.data

  const db = useDb()
  const { workspace, visitor } = await requireVisitorSession(event, site_id, visitor_session)
  assertRateLimit('widget-csat:visitor', visitor.id, { max: 6, windowMs: 60 * 1000 })
  assertRateLimit('widget-csat:workspace', workspace.id, { max: 60, windowMs: 60 * 1000 })

  const savedRating = await db.transaction(async (tx) => {
    const [conversation] = await tx.select().from(conversations)
      .where(and(
        eq(conversations.id, conversation_id),
        eq(conversations.visitorRef, visitor.id),
        eq(conversations.workspaceId, workspace.id)
      ))
      .for('update')

    if (!conversation) {
      throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
    }

    const duplicate = await tx.query.supportOutcomeEvents.findFirst({
      columns: { rating: true },
      where: and(
        eq(supportOutcomeEvents.conversationId, conversation.id),
        eq(supportOutcomeEvents.requestId, request_id)
      )
    })
    if (duplicate?.rating === 'good' || duplicate?.rating === 'bad') return duplicate.rating

    if (conversation.status !== 'resolved') {
      throw createError({ statusCode: 400, statusMessage: 'Only resolved conversations can be rated' })
    }

    const [revisions] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(supportOutcomeEvents)
      .where(and(
        eq(supportOutcomeEvents.conversationId, conversation.id),
        eq(supportOutcomeEvents.eventType, 'csat')
      ))
    if ((revisions?.count ?? 0) >= 10) {
      throw createError({ statusCode: 429, statusMessage: 'This conversation has reached its rating update limit' })
    }

    const resolution = await tx.query.supportOutcomeEvents.findFirst({
      columns: { actorMemberId: true },
      where: and(
        eq(supportOutcomeEvents.conversationId, conversation.id),
        eq(supportOutcomeEvents.eventType, 'resolution')
      ),
      orderBy: [desc(supportOutcomeEvents.occurredAt), desc(supportOutcomeEvents.id)]
    })
    const now = new Date()

    await tx.update(conversations)
      .set({ csatRating: rating, csatComment: comment || null, csatAt: now })
      .where(eq(conversations.id, conversation.id))

    await tx.insert(supportOutcomeEvents).values({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      eventType: 'csat',
      requestId: request_id,
      actorMemberId: resolution?.actorMemberId ?? null,
      rating,
      occurredAt: now
    })
    return rating
  })

  return { ok: true, rating: savedRating }
})
