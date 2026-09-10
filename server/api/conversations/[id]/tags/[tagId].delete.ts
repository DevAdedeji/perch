import { requireConversationMember } from '@@/server/domains/workspaces/access'
import { useDb } from '@@/server/database/client'
import { and, conversationTags, eq } from '@perch/db'

/** Remove a tag from a conversation. */
export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  const tagId = getRouterParam(event, 'tagId')!
  await requireConversationMember(event, conversationId)

  await useDb().delete(conversationTags)
    .where(and(eq(conversationTags.conversationId, conversationId), eq(conversationTags.tagId, tagId)))
  return { ok: true }
})
