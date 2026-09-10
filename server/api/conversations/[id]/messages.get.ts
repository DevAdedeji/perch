import { requireConversationMember } from '@@/server/domains/workspaces/access'
import { useDb } from '@@/server/database/client'
import { serializeMessage } from '@@/server/domains/conversations/messages'
import { and, desc, eq, messages, sql } from '@perch/db'

const DEFAULT_LIMIT = 50

/**
 * Message thread for agents (includes internal notes), newest page first.
 * Cursor pagination: `?before=<message_id>` returns the page older than that
 * message; `items` come back in ascending order ready to render.
 */
export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  await requireConversationMember(event, conversationId)

  const query = getQuery(event)
  const { limit, beforeId } = parseCursorPagination(query, DEFAULT_LIMIT)

  const db = useDb()

  let cursor = null
  if (beforeId) {
    cursor = await db.query.messages.findFirst({ where: eq(messages.id, beforeId) })
    if (!cursor || cursor.conversationId !== conversationId) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid cursor' })
    }
  }

  const rows = await db.query.messages.findMany({
    where: and(
      eq(messages.conversationId, conversationId),
      // tuple comparison keeps the order stable when timestamps collide
      cursor
        ? sql`(${messages.createdAt}, ${messages.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`
        : undefined
    ),
    orderBy: [desc(messages.createdAt), desc(messages.id)],
    limit: limit + 1
  })

  const hasMore = rows.length > limit
  const page = rows.slice(0, limit).reverse()
  return { items: page.map(serializeMessage), has_more: hasMore }
})
