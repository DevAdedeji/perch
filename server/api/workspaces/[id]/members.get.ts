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
      // §3.3 agent workload: what they're handling now vs. what they've closed
      openCount: sql<number>`(
        select count(*) from ${conversations} c
        where c.assigned_agent_id = ${workspaceMembers.id} and c.status = 'open'
      )`,
      resolvedCount: sql<number>`(
        select count(*) from ${conversations} c
        where c.assigned_agent_id = ${workspaceMembers.id} and c.status = 'resolved'
      )`,
      // CSAT rollup (§13.0.1): thumbs from resolved conversations they handled
      csatGood: sql<number>`(
        select count(*) from ${conversations} c
        where c.assigned_agent_id = ${workspaceMembers.id} and c.csat_rating = 'good'
      )`,
      csatBad: sql<number>`(
        select count(*) from ${conversations} c
        where c.assigned_agent_id = ${workspaceMembers.id} and c.csat_rating = 'bad'
      )`
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId)))

  // live presence from the in-process registry (§6.5)
  return rows.map(m => ({
    ...m,
    openCount: Number(m.openCount),
    resolvedCount: Number(m.resolvedCount),
    csatGood: Number(m.csatGood),
    csatBad: Number(m.csatBad),
    presence: memberPresence(workspaceId, m.id)
  }))
})
