import { requireMembership } from '@@/server/domains/workspaces/access'
import { memberNotificationPreferences } from '@@/server/domains/notifications/preferences'

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { member } = await requireMembership(event, workspaceId)
  return { preferences: await memberNotificationPreferences(member.id) }
})
