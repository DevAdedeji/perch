import { and, conversations, count, eq, ne, visitors } from '@perch/db'

/** Best-effort browser/OS labels from the raw UA (no dependency needed). */
function parseUa(ua?: string) {
  if (!ua) return { browser: null as string | null, os: null as string | null }
  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /opr\//i.test(ua)
      ? 'Opera'
      : /chrome\//i.test(ua)
        ? 'Chrome'
        : /safari\//i.test(ua) && /version\//i.test(ua)
          ? 'Safari'
          : /firefox\//i.test(ua) ? 'Firefox' : null
  const os = /iphone|ipad/i.test(ua)
    ? 'iOS'
    : /android/i.test(ua)
      ? 'Android'
      : /mac os x/i.test(ua)
        ? 'macOS'
        : /windows/i.test(ua) ? 'Windows' : /linux/i.test(ua) ? 'Linux' : null
  return { browser, os }
}

/**
 * Visitor context panel (§3.3): who the visitor is, where they are on the
 * site, their device, and their history with this workspace.
 */
export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  const { conversation } = await requireConversationMember(event, conversationId)

  const db = useDb()
  const visitor = await db.query.visitors.findFirst({ where: eq(visitors.id, conversation.visitorRef) })
  if (!visitor) {
    throw createError({ statusCode: 404, statusMessage: 'Visitor not found' })
  }

  const [past] = await db
    .select({ total: count() })
    .from(conversations)
    .where(and(eq(conversations.visitorRef, visitor.id), ne(conversations.id, conversationId)))

  const { browser, os } = parseUa(visitor.metadata.ua)

  return {
    visitor: {
      name: visitor.name,
      email: visitor.email,
      visitor_id: visitor.visitorId,
      first_seen_at: visitor.firstSeenAt.toISOString(),
      last_seen_at: visitor.lastSeenAt.toISOString(),
      page_url: visitor.metadata.page_url ?? null,
      browser,
      os
    },
    conversation: {
      created_at: conversation.createdAt.toISOString(),
      status: conversation.status,
      resolved_at: conversation.resolvedAt?.toISOString() ?? null
    },
    past_conversations: Number(past?.total ?? 0)
  }
})
