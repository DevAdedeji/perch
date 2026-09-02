import { conversations, eq, sql, users, workspaceMembers } from '@perch/db'

/** Role-aware roster used by assignment, mentions, presence, and Team management. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { member: viewer } = await requireMembership(event, workspaceId)

  const db = useDb()
  if (viewer.role !== 'admin') {
    const rows = await db
      .select({
        id: workspaceMembers.id,
        name: users.name,
        role: workspaceMembers.role
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))

    return rows.map(member => teamRosterMemberDto(
      member,
      memberPresence(workspaceId, member.id)
    ))
  }

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
    .where(eq(workspaceMembers.workspaceId, workspaceId))

  return rows.map(member => adminTeamRosterMemberDto(
    member,
    memberPresence(workspaceId, member.id)
  ))
})
