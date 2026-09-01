export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })
  const result = await cancelWorkspacePlan(workspaceId)
  logAudit(workspaceId, user, 'billing.cancellation_scheduled', result)
  return result
})
