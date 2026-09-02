import { and, eq, inArray, sql, webhookEndpoints, webhookEvents, webhookJobs } from '@perch/db'
import { webhookAuditTarget } from '../../../../utils/webhook-security'

/** Delete a webhook endpoint (admin). Its delivery log cascades away. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const webhookId = getRouterParam(event, 'webhookId')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })

  const row = await useDb().transaction(async (tx) => {
    const pending = await tx.select({ eventId: webhookJobs.eventId }).from(webhookJobs).where(and(
      eq(webhookJobs.endpointId, webhookId),
      eq(webhookJobs.workspaceId, workspaceId)
    ))
    const [deleted] = await tx.delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.workspaceId, workspaceId)))
      .returning()
    if (pending.length) {
      await tx.update(webhookEvents).set({ data: null }).where(and(
        inArray(webhookEvents.id, pending.map(item => item.eventId)),
        sql`not exists (select 1 from webhook_jobs where webhook_jobs.event_id = ${webhookEvents.id})`
      ))
    }
    return deleted
  })
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
  }

  logAudit(workspaceId, user, 'webhook.deleted', {
    url: webhookAuditTarget(row.url),
    endpoint_id: row.id
  })

  return { ok: true }
})
