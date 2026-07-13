import { and, conversationTags, eq, tags } from '@perch/db'
import { z } from 'zod'

/** Apply a tag to a conversation. */
export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  const { conversation } = await requireConversationMember(event, conversationId)

  const result = await readValidatedBody(event, body => z.object({ tag_id: z.string().uuid() }).safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input' })
  }

  const db = useDb()
  // the tag must belong to the same workspace — no cross-tenant labels
  const tag = await db.query.tags.findFirst({
    where: and(eq(tags.id, result.data.tag_id), eq(tags.workspaceId, conversation.workspaceId))
  })
  if (!tag) {
    throw createError({ statusCode: 404, statusMessage: 'Tag not found' })
  }

  await db.insert(conversationTags)
    .values({ conversationId, tagId: tag.id })
    .onConflictDoNothing()
  return { ok: true, tag: { id: tag.id, name: tag.name } }
})
