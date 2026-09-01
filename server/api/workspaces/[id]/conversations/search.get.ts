import { conversations, desc, eq, isNull, or, sql, visitors } from '@perch/db'
import { z } from 'zod'

/**
 * Inbox search: visitor name/email or message text, newest activity first.
 * Same role scoping as the inbox list — agents only see the pool + their own.
 * ILIKE is plenty at this scale; swap for tsvector when it isn't.
 */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { member } = await requireMembership(event, workspaceId)

  const query = await getValidatedQuery(event, q => z.object({
    q: z.string().trim().min(2, 'Type at least 2 characters').max(100)
  }).safeParse(q))
  if (!query.success) {
    throw createError({ statusCode: 400, statusMessage: query.error.issues[0]?.message ?? 'Invalid input' })
  }

  const scope = member.role === 'agent'
    ? or(
        isNull(conversations.assignedAgentId),
        eq(conversations.assignedAgentId, member.id),
        sql`${member.id}::uuid = any(${conversations.collaboratorMemberIds})`
      )
    : undefined
  // escape LIKE wildcards so "50%" searches for a literal percent sign
  const needle = `%${query.data.q.replace(/[%_\\]/g, '\\$&')}%`

  const rows = await useDb()
    .select({
      id: conversations.id,
      status: conversations.status,
      assignedAgentId: conversations.assignedAgentId,
      lastMessageAt: conversations.lastMessageAt,
      visitorRef: visitors.id,
      visitorName: sql<string | null>`coalesce(${visitors.profileName}, ${visitors.name})`,
      visitorEmail: sql<string | null>`coalesce(${visitors.profileEmail}, ${visitors.email})`,
      visitorPublicId: visitors.visitorId,
      // the best matching message, for a result snippet
      snippet: sql<string | null>`(
        select m.content from messages m
        where m.conversation_id = ${conversations.id}
          and m.is_internal_note = false
          and m.content ilike ${needle}
        order by m.created_at desc limit 1
      )`
    })
    .from(conversations)
    .innerJoin(visitors, eq(visitors.id, conversations.visitorRef))
    .where(sql`${conversations.workspaceId} = ${workspaceId}
      and (${scope ?? sql`true`})
      and (
        coalesce(${visitors.profileName}, '') ilike ${needle}
        or coalesce(${visitors.name}, '') ilike ${needle}
        or coalesce(${visitors.profileEmail}, '') ilike ${needle}
        or coalesce(${visitors.email}, '') ilike ${needle}
        or coalesce(${visitors.company}, '') ilike ${needle}
        or exists (
          select 1 from messages m
          where m.conversation_id = ${conversations.id}
            and m.is_internal_note = false
            and m.content ilike ${needle}
        )
      )`)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(20)

  return rows.map(r => ({
    id: r.id,
    status: r.status,
    assignedAgentId: r.assignedAgentId,
    lastMessageAt: r.lastMessageAt.toISOString(),
    snippet: r.snippet,
    visitor: {
      id: r.visitorRef,
      name: r.visitorName,
      email: r.visitorEmail,
      visitorId: r.visitorPublicId
    }
  }))
})
