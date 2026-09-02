import { and, eq, inArray, sql, visitorEmailSuppressions, visitorReplyDeliveries, visitors } from '@perch/db'
import { z } from 'zod'

const schema = z.object({ token: z.string().min(20).max(4096) })

export default defineEventHandler(async (event) => {
  assertRateLimit('visitor-reply-unsubscribe:ip', requestIp(event), { max: 20, windowMs: 60_000 })
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) throw createError({ statusCode: 400, statusMessage: 'Invalid unsubscribe link' })
  const payload = verifyReplyLinkToken(result.data.token, 'unsubscribe', event)
  if (!payload) throw createError({ statusCode: 410, statusMessage: 'This unsubscribe link is invalid or expired' })

  const delivery = await useDb().query.visitorReplyDeliveries.findFirst({
    where: eq(visitorReplyDeliveries.id, payload.deliveryId)
  })
  if (!delivery) throw createError({ statusCode: 410, statusMessage: 'This unsubscribe link is no longer available' })

  await useDb().transaction(async (tx) => {
    await tx.insert(visitorEmailSuppressions).values({
      workspaceId: delivery.workspaceId,
      emailHash: delivery.recipientEmailHash,
      reason: 'unsubscribe'
    }).onConflictDoNothing()
    const visitor = await tx.query.visitors.findFirst({ where: eq(visitors.id, delivery.visitorRef) })
    if (visitor?.email && visitorEmailHash(visitor.email) === delivery.recipientEmailHash) {
      await tx.update(visitors).set({ replyEmailEnabled: false, replyEmailConsentAt: null })
        .where(eq(visitors.id, visitor.id))
    }
    await tx.update(visitorReplyDeliveries).set({
      status: 'canceled', cancelReason: 'suppressed_unsubscribe', lockedAt: null, updatedAt: sql`now()`
    }).where(and(
      eq(visitorReplyDeliveries.workspaceId, delivery.workspaceId),
      eq(visitorReplyDeliveries.recipientEmailHash, delivery.recipientEmailHash),
      inArray(visitorReplyDeliveries.status, ['pending', 'failed'])
    ))
  })

  return { ok: true }
})
