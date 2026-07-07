import { eq, users, workspaceMembers } from '@perch/db'

/** Team roster for a workspace (for owner labels, reassignment, presence). */
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
      role: workspaceMembers.role
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))

  // live presence from the in-process registry (§6.5)
  return rows.map(m => ({ ...m, presence: memberPresence(workspaceId, m.id) }))
})
