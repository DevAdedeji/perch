import { asc, eq, tags } from '@perch/db'

/** Workspace tag vocabulary, alphabetical. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId)

  const rows = await useDb().query.tags.findMany({
    where: eq(tags.workspaceId, workspaceId),
    orderBy: asc(tags.name)
  })
  return rows.map(t => ({ id: t.id, name: t.name }))
})
