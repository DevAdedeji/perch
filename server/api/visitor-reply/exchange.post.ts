import { and, eq, sql, visitorReplyDeliveries, visitors } from '@perch/db'
import { z } from 'zod'

const schema = z.object({ token: z.string().min(20).max(4096) })

export default defineEventHandler(async (event) => {
  assertRateLimit('visitor-reply-exchange:ip', requestIp(event), { max: 20, windowMs: 60_000 })
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) throw createError({ statusCode: 400, statusMessage: 'Invalid return link' })
  const payload = verifyReplyLinkToken(result.data.token, 'open', event)
  if (!payload) throw createError({ statusCode: 410, statusMessage: 'This return link is invalid or expired' })

  const context = await useDb().transaction(async (tx) => {
    const [delivery] = await tx.select().from(visitorReplyDeliveries).where(and(
      eq(visitorReplyDeliveries.id, payload.deliveryId),
      eq(visitorReplyDeliveries.status, 'sent')
    )).for('update')
    if (!delivery || delivery.tokenConsumedAt || delivery.tokenExpiresAt.getTime() <= Date.now()) return null
    const visitor = await tx.query.visitors.findFirst({ where: eq(visitors.id, delivery.visitorRef) })
    if (!visitor?.email || visitorEmailHash(visitor.email) !== delivery.recipientEmailHash) return null
    const [consumed] = await tx.update(visitorReplyDeliveries).set({
      tokenConsumedAt: new Date(),
      updatedAt: new Date()
    }).where(and(
      eq(visitorReplyDeliveries.id, delivery.id),
      sql`${visitorReplyDeliveries.tokenConsumedAt} is null`
    )).returning()
    return consumed ? { delivery, visitor } : null
  })
  if (!context) throw createError({ statusCode: 410, statusMessage: 'This return link has already been used or revoked' })

  setReplySession(event, issueReplySession({
    deliveryId: context.delivery.id,
    workspaceId: context.delivery.workspaceId,
    visitorRef: context.delivery.visitorRef,
    conversationId: context.delivery.conversationId
  }, event))
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { ok: true }
})
