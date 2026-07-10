import { and, conversations, eq, sql, users, workspaceMembers } from '@perch/db'

/** Team roster for a workspace (owner labels, reassignment, presence, workload). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId)

  const db = useDb()
  const rows = await db
    .select({
      id: workspaceMembers.id,
      userId: workspaceMembers.userId,
      name: users.name,
      email: users.email,
      role: workspaceMembers.role,
      // §3.3 agent workload: conversations owned by this member, by status
      assignedCount: sql<number>`(
        select count(*) from ${conversations} c
        where c.assigned_agent_id = ${workspaceMembers.id}
      )`,
      openCount: sql<number>`(
        select count(*) from ${conversations} c
        where c.assigned_agent_id = ${workspaceMembers.id} and c.status = 'open'
      )`,
      resolvedCount: sql<number>`(
        select count(*) from ${conversations} c
        where c.assigned_agent_id = ${workspaceMembers.id} and c.status = 'resolved'
      )`
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId)))

  // live presence from the in-process registry (§6.5)
  return rows.map(m => ({
    ...m,
    assignedCount: Number(m.assignedCount),
    openCount: Number(m.openCount),
    resolvedCount: Number(m.resolvedCount),
    presence: memberPresence(workspaceId, m.id)
  }))
})
