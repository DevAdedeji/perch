import { desc, eq, triggers } from '@perch/db'

/** List the workspace's proactive triggers (any member; admins edit). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId)

  const rows = await useDb().query.triggers.findMany({
    where: eq(triggers.workspaceId, workspaceId),
    orderBy: [desc(triggers.createdAt)]
  })
  return rows.map(t => ({
    id: t.id,
    name: t.name,
    url_match: t.urlMatch,
    dwell_seconds: t.dwellSeconds,
    message: t.message,
    enabled: t.enabled
  }))
})
