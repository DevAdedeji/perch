import { desc, eq, webhookEndpoints } from '@perch/db'

/** List webhook endpoints (admin). Secrets are masked — shown once at creation. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId, { admin: true })

  const rows = await useDb().query.webhookEndpoints.findMany({
    where: eq(webhookEndpoints.workspaceId, workspaceId),
    orderBy: [desc(webhookEndpoints.createdAt)]
  })
  return rows.map(w => ({
    id: w.id,
    url: w.url,
    secret_hint: `whsec_…${w.secret.slice(-4)}`,
    events: w.events,
    enabled: w.enabled,
    created_at: w.createdAt.toISOString()
  }))
})
