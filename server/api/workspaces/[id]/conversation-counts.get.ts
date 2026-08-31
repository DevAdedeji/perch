import { and, conversations, count, eq, isNull, or, sql } from '@perch/db'

/** Per-status conversation counts for the inbox tabs (independent of the active filter). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { member } = await requireMembership(event, workspaceId)

  // Agents count the unassigned pool, their own chats, and chats where they
  // were brought in as a collaborator; admins count everything.
  const scope = member.role === 'agent'
    ? or(
        isNull(conversations.assignedAgentId),
        eq(conversations.assignedAgentId, member.id),
        sql`${member.id}::uuid = any(${conversations.collaboratorMemberIds})`
      )
    : undefined

  const db = useDb()
  const rows = await db
    .select({ status: conversations.status, total: count() })
    .from(conversations)
    .where(and(
      eq(conversations.workspaceId, workspaceId),
      sql`(${conversations.snoozedUntil} is null or ${conversations.snoozedUntil} <= now())`,
      scope
    ))
    .groupBy(conversations.status)

  const result = { unassigned: 0, open: 0, resolved: 0 }
  for (const row of rows) result[row.status] = Number(row.total)
  return result
})
