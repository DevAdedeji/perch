import { eq, users, workspaceMembers, workspaces } from '@perch/db'

/** Current user + their workspace memberships (roles change, so fetched live). */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  const db = useDb()
  const [dbUser, memberships] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, user.id) }),
    db
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
  ])

  return {
    user: {
      ...user,
      // the session cookie can go stale after an email change — DB is truth
      email: dbUser?.email ?? user.email,
      name: dbUser?.name ?? user.name,
      emailVerified: !!dbUser?.emailVerifiedAt
    },
    workspaces: memberships
  }
})
