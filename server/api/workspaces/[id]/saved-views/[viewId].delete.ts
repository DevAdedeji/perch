import { and, eq, inboxSavedViews } from '@perch/db'

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const viewId = getRouterParam(event, 'viewId')!
  const { member } = await requireMembership(event, workspaceId)
  const deleted = await useDb().delete(inboxSavedViews).where(and(
    eq(inboxSavedViews.id, viewId),
    eq(inboxSavedViews.memberId, member.id)
  )).returning({ id: inboxSavedViews.id })
  if (!deleted.length) throw createError({ statusCode: 404, statusMessage: 'Saved view not found' })
  setResponseStatus(event, 204)
})
