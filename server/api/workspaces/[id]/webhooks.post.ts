import { randomBytes } from 'node:crypto'
import { count, eq, webhookEndpoints } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  url: z.string().trim().url().max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1)
})

const MAX_ENDPOINTS = 10

/**
 * Create a webhook endpoint (admin). The signing secret is returned in FULL
 * only from this response — it's masked everywhere afterwards.
 */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid input' })
  }
  const { url, events } = result.data

  if (!isSafeWebhookUrl(url)) {
    throw createError({ statusCode: 400, statusMessage: 'That URL can\'t be used as a webhook endpoint' })
  }

  const db = useDb()
  const [{ n }] = await db.select({ n: count() }).from(webhookEndpoints).where(eq(webhookEndpoints.workspaceId, workspaceId)) as [{ n: number }]
  if (n >= MAX_ENDPOINTS) {
    throw createError({ statusCode: 400, statusMessage: `A workspace can have at most ${MAX_ENDPOINTS} webhook endpoints` })
  }

  const secret = `whsec_${randomBytes(24).toString('hex')}`
  const [row] = await db.insert(webhookEndpoints).values({
    workspaceId,
    url,
    secret,
    events: [...events]
  }).returning()

  invalidateWebhookCache(workspaceId)
  logAudit(workspaceId, user, 'webhook.created', { url })

  setResponseStatus(event, 201)
  return {
    id: row!.id,
    url: row!.url,
    // full secret — this is the only time it's ever sent
    secret,
    events: row!.events,
    enabled: row!.enabled,
    created_at: row!.createdAt.toISOString()
  }
})
