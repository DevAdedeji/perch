import { requireConversationMember } from '@@/server/domains/workspaces/access'
import { serializeConversation, setConversationStatus } from '@@/server/domains/conversations/messages'

export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  await requireConversationMember(event, conversationId)
  const conversation = await setConversationStatus(conversationId, 'open')
  return { conversation: serializeConversation(conversation!) }
})
