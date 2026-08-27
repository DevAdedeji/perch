import { and, eq, invites, users, workspaceMembers } from '@perch/db'

/** Accept an invite: the logged-in user joins the workspace as the invited role. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = getRouterParam(event, 'token')!

  const db = useDb()
  const invite = await db.query.invites.findFirst({ where: eq(invites.token, token) })

  if (!invite || invite.status !== 'pending') {
    throw createError({ statusCode: 400, statusMessage: 'This invite is no longer valid' })
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    throw createError({ statusCode: 400, statusMessage: 'This invite has expired' })
  }
  // Read the current database value: the sealed session's email may predate a
  // recently verified address change.
  const currentUser = await db.query.users.findFirst({ where: eq(users.id, user.id) })
  if (!currentUser || invite.email.toLowerCase() !== currentUser.email.toLowerCase()) {
    throw createError({ statusCode: 403, statusMessage: `This invite is for ${invite.email}. Sign in with that email to accept.` })
  }

  const joined = await db.transaction(async (tx) => {
    const [claimed] = await tx.update(invites).set({ status: 'accepted' }).where(and(
      eq(invites.id, invite.id), eq(invites.status, 'pending')
    )).returning()
    if (!claimed) throw createError({ statusCode: 400, statusMessage: 'This invite is no longer valid' })
    const [membership] = await tx.insert(workspaceMembers).values({
      workspaceId: invite.workspaceId,
      userId: user.id,
      role: invite.role
    }).onConflictDoNothing().returning()
    return !!membership
  })
  if (joined) logAudit(invite.workspaceId, user, 'member.joined', { role: invite.role })

  return { workspaceId: invite.workspaceId }
})
