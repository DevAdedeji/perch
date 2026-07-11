import { and, conversations, desc, eq, messages, visitors, workspaces } from '@perch/db'
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

  // resume the visitor's active (non-resolved) conversation
  const conversation = await db.query.conversations.findFirst({
    where: and(eq(conversations.visitorRef, visitor!.id), eq(conversations.status, 'open'))
  }) ?? await db.query.conversations.findFirst({
    where: and(eq(conversations.visitorRef, visitor!.id), eq(conversations.status, 'unassigned'))
  })

  let thread: MessageDTO[] = []
  if (conversation) {
    // last 100 is plenty for a resumed visitor thread — unbounded loads are
    // the kind of thing that degrades invisibly as usage accumulates
    const rows = await db.query.messages.findMany({
      where: and(eq(messages.conversationId, conversation.id), eq(messages.isInternalNote, false)),
      orderBy: desc(messages.createdAt),
      limit: 100
    })
    thread = rows.reverse().map(serializeMessage)
  }

  const secret = (useRuntimeConfig(event).realtimeSecret || process.env.NUXT_SESSION_PASSWORD)!
  const wsTicket = signTicket({ role: 'visitor', wid: workspace.id, vid: visitor!.id }, secret)

  const agentName = conversation?.assignedAgentId ? await getMemberName(conversation.assignedAgentId) : null

  return {
    workspace: {
      name: workspace.name,
      color: workspace.widgetPrimaryColor,
      logo_url: workspace.logoUrl,
      prechat_enabled: workspace.prechatFormEnabled
    },
    agent: agentName ? { name: agentName } : null,
    visitor: { name: visitor!.name, email: visitor!.email },
    business_online: isBusinessOnline(workspace.id),
    conversation_id: conversation?.id ?? null,
    messages: thread,
    ws_ticket: wsTicket,
    presence_channel: presenceChannel(workspace.id)
  }
})
