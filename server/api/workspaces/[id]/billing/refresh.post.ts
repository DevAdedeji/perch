export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { user, member } = await requireMembership(event, workspaceId, { admin: true })
  assertRateLimit('billing-refresh:member', member.id, { max: 10, windowMs: 5 * 60_000 })
  if (!bachsConfigured()) {
    throw createError({ statusCode: 503, statusMessage: 'Billing is not configured on this environment yet.' })
  }
  const result = await reconcileWorkspaceBilling(workspaceId)
  if (!result) throw createError({ statusCode: 503, statusMessage: 'Billing status is already being checked.' })
  logAudit(workspaceId, user, 'billing.reconciled', {
    invoicesChecked: result.invoicesChecked,
    invoicesChanged: result.invoicesChanged,
    subscriptionChecked: result.subscriptionChecked,
    awaitingSubscription: result.awaitingSubscription
  })
  return result
})
