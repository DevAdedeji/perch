import { requireMembership } from '@@/server/domains/workspaces/access'
import { billingOverview } from '@@/server/domains/billing/subscriptions'

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId, { admin: true })
  return billingOverview(workspaceId)
})
