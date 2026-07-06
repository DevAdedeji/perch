import { and, eq, invites, workspaceMembers } from '@perch/db'

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
  // the invite is bound to a specific email address
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    throw createError({ statusCode: 403, statusMessage: `This invite is for ${invite.email}. Sign in with that email to accept.` })
  }

  // idempotent — joining twice is a no-op
  const existing = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, invite.workspaceId), eq(workspaceMembers.userId, user.id))
  })
  if (!existing) {
    await db.insert(workspaceMembers).values({
      workspaceId: invite.workspaceId,
      userId: user.id,
      role: invite.role
    })
  }

  await db.update(invites).set({ status: 'accepted' }).where(eq(invites.id, invite.id))

  return { workspaceId: invite.workspaceId }
})
