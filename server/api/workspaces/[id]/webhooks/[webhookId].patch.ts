import { and, eq, webhookEndpoints } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  url: z.string().trim().url().max(500).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  enabled: z.boolean().optional()
}).refine(d => Object.keys(d).length > 0, { message: 'Nothing to update' })

/** Update a webhook endpoint (admin) — url, subscriptions, enable/disable. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const webhookId = getRouterParam(event, 'webhookId')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid input' })
  }
  const d = result.data

  if (d.url && !isSafeWebhookUrl(d.url)) {
    throw createError({ statusCode: 400, statusMessage: 'That URL can\'t be used as a webhook endpoint' })
  }

  const [row] = await useDb().update(webhookEndpoints)
    .set({
      ...(d.url !== undefined ? { url: d.url } : {}),
      ...(d.events !== undefined ? { events: [...d.events] } : {}),
      ...(d.enabled !== undefined ? { enabled: d.enabled } : {})
    })
    .where(and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.workspaceId, workspaceId)))
    .returning()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
  }

  invalidateWebhookCache(workspaceId)
  logAudit(workspaceId, user, 'webhook.updated', { url: row.url, changed: Object.keys(d) })

  return {
    id: row.id,
    url: row.url,
    secret_hint: `whsec_…${row.secret.slice(-4)}`,
    events: row.events,
    enabled: row.enabled,
    created_at: row.createdAt.toISOString()
  }
})
