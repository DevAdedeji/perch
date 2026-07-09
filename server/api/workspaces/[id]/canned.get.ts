import { asc, cannedResponses, eq } from '@perch/db'

/** Canned responses for the composer's `/shortcut` picker + settings management. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId)

  const rows = await useDb().query.cannedResponses.findMany({
    where: eq(cannedResponses.workspaceId, workspaceId),
    orderBy: asc(cannedResponses.shortcut)
  })
  return rows.map(r => ({ id: r.id, shortcut: r.shortcut, content: r.content }))
})
