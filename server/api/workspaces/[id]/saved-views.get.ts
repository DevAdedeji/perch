import { asc, eq, inboxSavedViews } from '@perch/db'

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { member } = await requireMembership(event, workspaceId)
  const views = await useDb().query.inboxSavedViews.findMany({
    where: eq(inboxSavedViews.memberId, member.id),
    orderBy: asc(inboxSavedViews.createdAt)
  })

  return views.map(view => ({
    id: view.id,
    name: view.name,
    filters: view.filters,
    created_at: view.createdAt.toISOString(),
    updated_at: view.updatedAt.toISOString()
  }))
})
