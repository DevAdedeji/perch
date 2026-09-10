import { requireConversationMember } from '@@/server/domains/workspaces/access'
import { getCustomerContext } from '@@/server/domains/visitors/profiles'
/** Private customer context for an agent who can access this conversation. */
export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  const { conversation, member } = await requireConversationMember(event, conversationId)
  return getCustomerContext(conversation, member)
})
