import { eq, workspaceMembers, workspaces } from '@perch/db'

/** Current user + their workspace memberships (roles change, so fetched live). */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  const db = useDb()
  const memberships = await db
    .select({
      memberId: workspaceMembers.id,
      role: workspaceMembers.role,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      siteId: workspaces.siteId
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, user.id))

  return { user, workspaces: memberships }
})
