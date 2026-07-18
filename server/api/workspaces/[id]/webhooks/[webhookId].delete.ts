import { and, eq, webhookEndpoints } from '@perch/db'

/** Delete a webhook endpoint (admin). Its delivery log cascades away. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const webhookId = getRouterParam(event, 'webhookId')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })

  const [row] = await useDb().delete(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.workspaceId, workspaceId)))
    .returning()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
  }

  invalidateWebhookCache(workspaceId)
  logAudit(workspaceId, user, 'webhook.deleted', { url: row.url })

  return { ok: true }
})
