import { and, articleGroups, eq } from '@perch/db'

/** Delete a help-center group and everything in it (admin only). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const groupId = getRouterParam(event, 'groupId')!
  await requireMembership(event, workspaceId, { admin: true })

  const [deleted] = await useDb().delete(articleGroups)
    .where(and(eq(articleGroups.id, groupId), eq(articleGroups.workspaceId, workspaceId)))
    .returning()
  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Group not found' })
  }
  return { ok: true }
})
