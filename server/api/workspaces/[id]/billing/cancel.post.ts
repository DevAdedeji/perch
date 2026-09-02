export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })
  assertRateLimit('billing-cancel:workspace', workspaceId, { max: 5, windowMs: 60 * 60_000 })
  const result = await cancelWorkspacePlan(workspaceId)
  logAudit(workspaceId, user, 'billing.cancellation_scheduled', result)
  return result
})
