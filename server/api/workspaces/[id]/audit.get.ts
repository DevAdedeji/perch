import { auditLogs, desc, eq } from '@perch/db'
import { webhookAuditTarget } from '../../../utils/webhook-security'

/** The workspace audit trail, newest first (admin only). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId, { admin: true })

  const rows = await useDb().query.auditLogs.findMany({
    where: eq(auditLogs.workspaceId, workspaceId),
    orderBy: desc(auditLogs.createdAt),
    limit: 100
  })

  return rows.map((row) => {
    const detail = { ...row.detail }
    if (row.action.startsWith('webhook.') && typeof detail.url === 'string') {
      detail.url = webhookAuditTarget(detail.url)
    }
    return {
      id: row.id,
      actor_name: row.actorName,
      action: row.action,
      detail,
      created_at: row.createdAt
    }
  })
})
