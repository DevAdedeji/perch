import { and, eq, webhookEndpoints } from '@perch/db'

/** Recent delivery attempts for one endpoint (admin) — newest first. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const webhookId = getRouterParam(event, 'webhookId')!
  await requireMembership(event, workspaceId, { admin: true })

  const endpoint = await useDb().query.webhookEndpoints.findFirst({
    where: and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.workspaceId, workspaceId))
  })
  if (!endpoint) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
  }

  return { deliveries: await recentDeliveries(endpoint.id) }
})
