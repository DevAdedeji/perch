import { conversations, count, eq } from '@perch/db'

/** Per-status conversation counts for the inbox tabs (independent of the active filter). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId)

  const db = useDb()
  const rows = await db
    .select({ status: conversations.status, total: count() })
    .from(conversations)
    .where(eq(conversations.workspaceId, workspaceId))
    .groupBy(conversations.status)

  const result = { unassigned: 0, open: 0, resolved: 0 }
  for (const row of rows) result[row.status] = Number(row.total)
  return result
})
