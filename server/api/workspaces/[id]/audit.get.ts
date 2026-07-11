import { auditLogs, desc, eq } from '@perch/db'

/** The workspace audit trail, newest first (admin only). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId, { admin: true })

  const rows = await useDb().query.auditLogs.findMany({
    where: eq(auditLogs.workspaceId, workspaceId),
    orderBy: desc(auditLogs.createdAt),
    limit: 100
  })

  return rows.map(r => ({
    id: r.id,
    actor_name: r.actorName,
    action: r.action,
    detail: r.detail,
    created_at: r.createdAt
  }))
})
