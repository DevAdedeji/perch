import { and, cannedResponses, eq } from '@perch/db'

/** Delete a canned response. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const cannedId = getRouterParam(event, 'cannedId')!
  await requireMembership(event, workspaceId)

  await useDb()
    .delete(cannedResponses)
    .where(and(eq(cannedResponses.id, cannedId), eq(cannedResponses.workspaceId, workspaceId)))
  return { ok: true }
})
