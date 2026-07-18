import { and, eq, webhookEndpoints } from '@perch/db'

/**
 * Send a sample signed `conversation.created` to one endpoint and report how
 * it went (admin). One real attempt, no retries — this is a debugging probe.
 */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const webhookId = getRouterParam(event, 'webhookId')!
  await requireMembership(event, workspaceId, { admin: true })
  assertRateLimit('webhook-test:ws', workspaceId, { max: 10, windowMs: 60 * 1000 })

  const endpoint = await useDb().query.webhookEndpoints.findFirst({
    where: and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.workspaceId, workspaceId))
  })
  if (!endpoint) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
  }

  const now = new Date().toISOString()
  const body = webhookEnvelope('conversation.created', {
    test: true,
    conversation: {
      id: '00000000-0000-4000-8000-000000000000',
      workspace_id: workspaceId,
      visitor_ref: '00000000-0000-4000-8000-000000000001',
      assigned_agent_id: null,
      status: 'unassigned',
      last_message_at: now,
      created_at: now,
      updated_at: now,
      resolved_at: null
    },
    visitor: { id: '00000000-0000-4000-8000-000000000001', name: 'Test Visitor', email: 'test@example.com' }
  })

  return await deliverOnce(endpoint, 'conversation.created', body, 1)
})
