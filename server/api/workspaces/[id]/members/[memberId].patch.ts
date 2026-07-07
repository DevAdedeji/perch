import { and, count, eq, workspaceMembers } from '@perch/db'
import { z } from 'zod'

const schema = z.object({ role: z.enum(['admin', 'agent']) })

/** Change a member's role (admin only; a workspace must keep ≥1 admin). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const memberId = getRouterParam(event, 'memberId')!
  await requireMembership(event, workspaceId, { admin: true })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input' })
  }

  const db = useDb()
  const target = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, workspaceId))
  })
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found' })
  }

  if (target.role === 'admin' && result.data.role === 'agent') {
    const rows = await db
      .select({ admins: count() })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'admin')))
    if ((rows[0]?.admins ?? 0) <= 1) {
      throw createError({ statusCode: 400, statusMessage: 'The workspace must have at least one admin' })
    }
  }

  const [updated] = await db.update(workspaceMembers)
    .set({ role: result.data.role })
    .where(eq(workspaceMembers.id, memberId))
    .returning()

  return { member: { id: updated!.id, role: updated!.role } }
})
