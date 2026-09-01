import { and, conversationReads, conversations, desc, eq, inArray, isNull, messages, or, sql, visitors } from '@perch/db'

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
  const parsedFilters = parseInboxFilters(query)
  if (!parsedFilters.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid inbox filters', data: parsedFilters.error.flatten() })
  }
  const filters = parsedFilters.data
  if (member.role === 'agent' && !['any', 'me', 'unassigned', member.id].includes(filters.assignee)) {
    throw createError({ statusCode: 403, statusMessage: 'You cannot view another agent\'s inbox' })
  }
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const beforeId = typeof query.before === 'string' ? query.before : null

  // Agents see the unassigned pool, their own chats, and chats where they were
  // brought in as a collaborator; admins see everything.
  const scope = member.role === 'agent'
    ? or(
        isNull(conversations.assignedAgentId),
        eq(conversations.assignedAgentId, member.id),
        sql`${member.id}::uuid = any(${conversations.collaboratorMemberIds})`
      )
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
      collaboratorMemberIds: conversations.collaboratorMemberIds,
      priority: conversations.priority,
      snoozedUntil: conversations.snoozedUntil,
      lastMessageAt: conversations.lastMessageAt,
      createdAt: conversations.createdAt,
      visitorRef: visitors.id,
      visitorName: sql<string | null>`coalesce(${visitors.profileName}, ${visitors.name})`,
      visitorEmail: sql<string | null>`coalesce(${visitors.profileEmail}, ${visitors.email})`,
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
      filters.status ? eq(conversations.status, filters.status) : undefined,
      filters.priorities.length ? inArray(conversations.priority, filters.priorities) : undefined,
      filters.assignee === 'unassigned'
        ? isNull(conversations.assignedAgentId)
        : filters.assignee === 'me'
          ? eq(conversations.assignedAgentId, member.id)
          : filters.assignee !== 'any'
            ? eq(conversations.assignedAgentId, filters.assignee)
            : undefined,
      ...filters.tagIds.map(tagId => sql`exists (
        select 1 from conversation_tags ct
        where ct.conversation_id = ${conversations.id} and ct.tag_id = ${tagId}::uuid
      )`),
      filters.snoozed === 'exclude'
        ? sql`(${conversations.snoozedUntil} is null or ${conversations.snoozedUntil} <= now())`
        : filters.snoozed === 'only'
          ? sql`${conversations.snoozedUntil} > now()`
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
      collaboratorMemberIds: r.collaboratorMemberIds,
      priority: r.priority,
      snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
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
