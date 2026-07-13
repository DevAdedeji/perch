import { and, conversationReads, conversations, desc, eq, isNull, messages, or, sql, visitors } from '@perch/db'
import { CONVERSATION_STATUSES } from '@perch/shared'
import type { ConversationStatus } from '@perch/shared'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

/**
 * Inbox list for a workspace with per-agent unread, optionally filtered by
 * status. Cursor pagination on last activity: `?before=<conversation_id>`
 * returns the page of conversations less recently active than that one.
 */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { member } = await requireMembership(event, workspaceId)

  const query = getQuery(event)
  const statusParam = query.status as string | undefined
  const status = CONVERSATION_STATUSES.includes(statusParam as ConversationStatus)
    ? (statusParam as ConversationStatus)
    : undefined
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const beforeId = typeof query.before === 'string' ? query.before : null
  const tagId = typeof query.tag === 'string' && query.tag ? query.tag : null

  // agents see only the unassigned pool + their own chats; admins see everything
  const scope = member.role === 'agent'
    ? or(isNull(conversations.assignedAgentId), eq(conversations.assignedAgentId, member.id))
    : undefined

  const db = useDb()

  let cursor = null
  if (beforeId) {
    cursor = await db.query.conversations.findFirst({ where: eq(conversations.id, beforeId) })
    if (!cursor || cursor.workspaceId !== workspaceId) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid cursor' })
    }
  }

  const rows = await db
    .select({
      id: conversations.id,
      status: conversations.status,
      assignedAgentId: conversations.assignedAgentId,
      lastMessageAt: conversations.lastMessageAt,
      createdAt: conversations.createdAt,
      visitorRef: visitors.id,
      visitorName: visitors.name,
      visitorEmail: visitors.email,
      visitorPublicId: visitors.visitorId,
      lastReadAt: conversationReads.lastReadAt,
      preview: sql<string | null>`(select coalesce(nullif(m.content, ''), case when m.attachment_url is not null then '📷 Photo' end) from ${messages} m where m.conversation_id = ${conversations.id} order by m.created_at desc limit 1)`,
      tags: sql<{ id: string, name: string }[]>`coalesce((
        select json_agg(json_build_object('id', t.id, 'name', t.name) order by t.name)
        from conversation_tags ct join tags t on t.id = ct.tag_id
        where ct.conversation_id = ${conversations.id}
      ), '[]'::json)`
    })
    .from(conversations)
    .innerJoin(visitors, eq(visitors.id, conversations.visitorRef))
    .leftJoin(
      conversationReads,
      and(eq(conversationReads.conversationId, conversations.id), eq(conversationReads.memberId, member.id))
    )
    .where(and(
      eq(conversations.workspaceId, workspaceId),
      status ? eq(conversations.status, status) : undefined,
      tagId
        ? sql`exists (select 1 from conversation_tags ct where ct.conversation_id = ${conversations.id} and ct.tag_id = ${tagId}::uuid)`
        : undefined,
      scope,
      // tuple comparison keeps the order stable when timestamps collide
      cursor
        ? sql`(${conversations.lastMessageAt}, ${conversations.id}) < (${cursor.lastMessageAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`
        : undefined
    ))
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)

  return {
    items: page.map(r => ({
      id: r.id,
      status: r.status,
      assignedAgentId: r.assignedAgentId,
      lastMessageAt: r.lastMessageAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      preview: r.preview ?? '',
      tags: r.tags ?? [],
      unread: !r.lastReadAt || r.lastMessageAt > r.lastReadAt,
      visitor: {
        id: r.visitorRef,
        name: r.visitorName,
        email: r.visitorEmail,
        visitorId: r.visitorPublicId
      }
    })),
    has_more: hasMore
  }
})
