import { z } from 'zod'

const schema = z.object({ request_id: z.string().uuid() }).strict()

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const endpointId = getRouterParam(event, 'webhookId')!
  const deliveryId = getRouterParam(event, 'deliveryId')!
  const { user, member } = await requireMembership(event, workspaceId, { admin: true })
  if (!webhookDeliveryEnabled()) {
    throw createError({ statusCode: 503, statusMessage: 'Webhook delivery is not enabled' })
  }
  assertRateLimit('webhook-replay:member', `${member.id}:${deliveryId}`, { max: 5, windowMs: 60_000 })

  const parsed = await readValidatedBody(event, body => schema.safeParse(body))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'A valid replay request ID is required' })

  try {
    const job = await replayWebhookJob({
      workspaceId,
      endpointId,
      jobId: deliveryId,
      requestId: parsed.data.request_id
    })
    logAudit(workspaceId, user, 'webhook.delivery_replayed', {
      endpoint_id: endpointId,
      delivery_id: deliveryId
    })
    return {
      id: job.id,
      status: job.status,
      attempts: job.attempts,
      next_attempt_at: job.nextAttemptAt?.toISOString() ?? null,
      replay_count: job.replayCount
    }
  } catch (error) {
    if (!(error instanceof WebhookReplayError)) throw error
    throw createError({
      statusCode: error.message === 'Delivery not found' ? 404 : 409,
      statusMessage: error.message
    })
  }
})
