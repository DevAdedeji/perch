import { and, conversationReads, conversations, desc, eq, isNull, messages, or, sql, visitors } from '@perch/db'
import { CONVERSATION_STATUSES } from '@perch/shared'
import type { ConversationStatus } from '@perch/shared'

/** Inbox list for a workspace, optionally filtered by status, with per-agent unread. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { member } = await requireMembership(event, workspaceId)

  const statusParam = getQuery(event).status as string | undefined
  const status = CONVERSATION_STATUSES.includes(statusParam as ConversationStatus)
    ? (statusParam as ConversationStatus)
    : undefined

  // agents see only the unassigned pool + their own chats; admins see everything
  const scope = member.role === 'agent'
    ? or(isNull(conversations.assignedAgentId), eq(conversations.assignedAgentId, member.id))
    : undefined

  const db = useDb()
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
      preview: sql<string | null>`(select content from ${messages} m where m.conversation_id = ${conversations.id} order by m.created_at desc limit 1)`
    })
    .from(conversations)
    .innerJoin(visitors, eq(visitors.id, conversations.visitorRef))
    .leftJoin(
      conversationReads,
      and(eq(conversationReads.conversationId, conversations.id), eq(conversationReads.memberId, member.id))
    )
    .where(and(eq(conversations.workspaceId, workspaceId), status ? eq(conversations.status, status) : undefined, scope))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(100)

  return rows.map(r => ({
    id: r.id,
    status: r.status,
    assignedAgentId: r.assignedAgentId,
    lastMessageAt: r.lastMessageAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    preview: r.preview ?? '',
    unread: !r.lastReadAt || r.lastMessageAt > r.lastReadAt,
    visitor: {
      id: r.visitorRef,
      name: r.visitorName,
      email: r.visitorEmail,
      visitorId: r.visitorPublicId
    }
  }))
})
