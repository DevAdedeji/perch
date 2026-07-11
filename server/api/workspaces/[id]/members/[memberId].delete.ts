import { and, count, eq, users, workspaceMembers } from '@perch/db'

/** Remove a member (admin only; not yourself, and never the last admin). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const memberId = getRouterParam(event, 'memberId')!
  const { user, member: caller } = await requireMembership(event, workspaceId, { admin: true })

  const db = useDb()
  const target = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, workspaceId))
  })
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found' })
  }
  if (target.id === caller.id) {
    throw createError({ statusCode: 400, statusMessage: 'You can’t remove yourself' })
  }
  if (target.role === 'admin') {
    const rows = await db
      .select({ admins: count() })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'admin')))
    if ((rows[0]?.admins ?? 0) <= 1) {
      throw createError({ statusCode: 400, statusMessage: 'The workspace must have at least one admin' })
    }
  }

  const targetUser = await db.query.users.findFirst({ where: eq(users.id, target.userId) })
  await db.delete(workspaceMembers).where(eq(workspaceMembers.id, memberId))
  logAudit(workspaceId, user, 'member.removed', {
    member: targetUser?.name ?? target.userId,
    role: target.role
  })
  return { ok: true }
})
