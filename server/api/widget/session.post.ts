import { and, articles, conversationReads, conversations, desc, eq, messages, sql, visitors, workspaces } from '@perch/db'
import type { MessageDTO } from '@perch/shared'
import { z } from 'zod'

const schema = z.object({
  site_id: z.string().min(1),
  visitor_id: z.string().min(8).max(128),
  page_url: z.string().max(2000).optional(),
  ua: z.string().max(500).optional()
})

/**
 * Public widget handshake. Validates the site, upserts the visitor, resumes any
 * active conversation (visitor-safe thread — no internal notes), and issues a
 * scoped visitor WS ticket. No conversation is created until the visitor speaks.
 */
export default defineEventHandler(async (event) => {
  assertRateLimit('widget-session:ip', requestIp(event), { max: 30, windowMs: 60 * 1000 })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input' })
  }
  const { site_id, visitor_id, page_url } = result.data

  const db = useDb()
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.siteId, site_id) })
  if (!workspace) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown site' })
  }
  // anyone can copy a site_id out of page source — the domain allowlist is
  // what stops strangers from mounting this workspace's chat on their site
  if (!isDomainAllowed(page_url, workspace.allowedDomains)) {
    throw createError({ statusCode: 403, statusMessage: 'This site is not allowed to embed this chat' })
  }

  const now = new Date()
  const [visitor] = await db.insert(visitors).values({
    workspaceId: workspace.id,
    visitorId: visitor_id,
    lastSeenAt: now,
    metadata: page_url ? { page_url } : {}
  }).onConflictDoUpdate({
    target: [visitors.workspaceId, visitors.visitorId],
    set: { lastSeenAt: now }
  }).returning()

  // resume the visitor's conversation — active ones first, else their most
  // recent resolved one (shown with a "closed" divider; replying reopens it)
  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.visitorRef, visitor!.id),
    orderBy: [
      sql`case when ${conversations.status} = 'open' then 0 when ${conversations.status} = 'unassigned' then 1 else 2 end`,
      desc(conversations.lastMessageAt)
    ]
  })

  let thread: MessageDTO[] = []
  let agentName: string | null = null
  let agentLastReadAt: string | null = null
  if (conversation) {
    // three independent reads — one round trip instead of three.
    // (thread capped at the last 100: unbounded loads degrade invisibly)
    const [rows, name, [read]] = await Promise.all([
      db.query.messages.findMany({
        where: and(eq(messages.conversationId, conversation.id), eq(messages.isInternalNote, false)),
        orderBy: desc(messages.createdAt),
        limit: 100
      }),
      conversation.assignedAgentId ? getMemberName(conversation.assignedAgentId) : Promise.resolve(null),
      db.select({ last: sql<string | null>`max(${conversationReads.lastReadAt})` })
        .from(conversationReads)
        .where(eq(conversationReads.conversationId, conversation.id))
    ])
    thread = rows.reverse().map(serializeMessage)
    agentName = name
    agentLastReadAt = read?.last ? new Date(read.last).toISOString() : null
  }

  const secret = (useRuntimeConfig(event).realtimeSecret || process.env.NUXT_SESSION_PASSWORD)!
  const wsTicket = signTicket({ role: 'visitor', wid: workspace.id, vid: visitor!.id }, secret)

  // the Help tab only renders when there's something to read
  const published = await db.query.articles.findFirst({
    where: and(eq(articles.workspaceId, workspace.id), eq(articles.status, 'published')),
    columns: { id: true }
  })

  const withinHours = isWithinBusinessHours(workspace.businessHours, workspace.timezone)

  return {
    workspace: {
      name: workspace.name,
      color: workspace.widgetPrimaryColor,
      logo_url: workspace.logoUrl,
      prechat_enabled: workspace.prechatFormEnabled,
      has_articles: !!published
    },
    agent: agentName ? { name: agentName } : null,
    visitor: { name: visitor!.name, email: visitor!.email },
    business_online: isBusinessOnline(workspace.id) && withinHours,
    business_state: withinHours ? businessPresence(workspace.id) : 'offline' as const,
    within_hours: withinHours,
    away_label: withinHours ? null : nextOpeningLabel(workspace.businessHours, workspace.timezone),
    conversation_status: conversation?.status ?? null,
    csat_rating: conversation?.csatRating ?? null,
    conversation_id: conversation?.id ?? null,
    agent_last_read_at: agentLastReadAt,
    messages: thread,
    ws_ticket: wsTicket,
    presence_channel: presenceChannel(workspace.id)
  }
})
