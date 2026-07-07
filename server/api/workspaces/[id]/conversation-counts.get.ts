import { and, conversations, count, eq, isNull, or } from '@perch/db'

/** Per-status conversation counts for the inbox tabs (independent of the active filter). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { member } = await requireMembership(event, workspaceId)

  // agents only count the unassigned pool + their own; admins count everything
  const scope = member.role === 'agent'
    ? or(isNull(conversations.assignedAgentId), eq(conversations.assignedAgentId, member.id))
    : undefined

  const db = useDb()
  const rows = await db
    .select({ status: conversations.status, total: count() })
    .from(conversations)
    .where(and(eq(conversations.workspaceId, workspaceId), scope))
    .groupBy(conversations.status)

  const result = { unassigned: 0, open: 0, resolved: 0 }
  for (const row of rows) result[row.status] = Number(row.total)
  return result
})
