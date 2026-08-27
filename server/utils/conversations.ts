import { and, conversations, desc, eq, messages, ne, sql, triggerFires, triggers, visitors } from '@perch/db'
import type { Conversation, Message } from '@perch/db'
import { channels } from '@perch/shared'
import type { ConversationDTO, MessageDTO } from '@perch/shared'

/* serialization (rows → §6 wire DTOs) */

export function serializeConversation(c: Conversation): ConversationDTO {
  return {
    id: c.id,
    workspace_id: c.workspaceId,
    visitor_ref: c.visitorRef,
    assigned_agent_id: c.assignedAgentId,
    status: c.status,
    last_message_at: c.lastMessageAt.toISOString(),
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
    resolved_at: c.resolvedAt ? c.resolvedAt.toISOString() : null
  }
}

export function serializeMessage(m: Message): MessageDTO {
  return {
    id: m.id,
    conversation_id: m.conversationId,
    sender_type: m.senderType,
    sender_id: m.senderId,
    content: m.content,
    attachment_url: m.attachmentUrl,
    attachment_type: m.attachmentType,
    is_internal_note: m.isInternalNote,
    created_at: m.createdAt.toISOString()
  }
}

/* visitor → business (used by the embed widget) */

interface IncomingVisitorMessage {
  workspaceId: string
  visitorId: string
  name?: string | null
  email?: string | null
  content: string
  attachmentUrl?: string | null
  attachmentType?: string | null
  pageUrl?: string
  /** the proactive trigger this message answers — its text is threaded in as a system line */
  triggerId?: string
}

/**
 * A visitor sends a message. Reuses the visitor's open conversation if one
 * exists (returning-visitor resume, §9), otherwise starts a new `unassigned`
 * one. Broadcasts `conversation.new`/`conversation.updated` + `message.new`.
 */
export async function ingestVisitorMessage(input: IncomingVisitorMessage) {
  const db = useDb()
  const now = new Date()
  const result = await db.transaction(async (tx) => {
    // The conflict update locks this visitor row until commit. Concurrent first
    // messages for one visitor therefore serialize before checking for a chat.
    const [visitor] = await tx.insert(visitors).values({
      workspaceId: input.workspaceId,
      visitorId: input.visitorId,
      name: input.name ?? null,
      email: input.email ?? null,
      lastSeenAt: now,
      metadata: input.pageUrl ? { page_url: input.pageUrl } : {}
    }).onConflictDoUpdate({
      target: [visitors.workspaceId, visitors.visitorId],
      set: {
        lastSeenAt: now,
        ...(input.name ? { name: input.name } : {}),
        ...(input.email ? { email: input.email } : {}),
        ...(input.pageUrl
          ? { metadata: sql`coalesce(${visitors.metadata}, '{}'::jsonb) || ${JSON.stringify({ page_url: input.pageUrl })}::jsonb` }
          : {})
      }
    }).returning()

    const existing = await tx.query.conversations.findFirst({
      where: eq(conversations.visitorRef, visitor!.id),
      orderBy: [
        sql`case when ${conversations.status} = 'open' then 0 when ${conversations.status} = 'unassigned' then 1 else 2 end`,
        desc(conversations.lastMessageAt)
      ]
    })

    let conversation: Conversation
    let isNew = false
    if (existing) {
      const [updated] = await tx.update(conversations).set({
        lastMessageAt: now,
        updatedAt: now,
        ...(existing.status === 'resolved'
          ? { status: existing.assignedAgentId ? 'open' as const : 'unassigned' as const, resolvedAt: null }
          : {})
      }).where(eq(conversations.id, existing.id)).returning()
      conversation = updated!
    } else {
      const [created] = await tx.insert(conversations).values({
        workspaceId: input.workspaceId,
        visitorRef: visitor!.id,
        status: 'unassigned',
        lastMessageAt: now
      }).returning()
      conversation = created!
      isNew = true

      if (input.triggerId) {
        const [rule, fire] = await Promise.all([
          tx.query.triggers.findFirst({
            where: and(eq(triggers.id, input.triggerId), eq(triggers.workspaceId, input.workspaceId))
          }),
          tx.query.triggerFires.findFirst({
            where: and(eq(triggerFires.triggerId, input.triggerId), eq(triggerFires.visitorRef, visitor!.id))
          })
        ])
        if (rule && fire) {
          await tx.insert(messages).values({
            conversationId: conversation.id,
            senderType: 'system',
            content: rule.message,
            createdAt: new Date(now.getTime() - 1000)
          })
        }
      }
    }

    const [message] = await tx.insert(messages).values({
      conversationId: conversation.id,
      senderType: 'visitor',
      content: input.content,
      attachmentUrl: input.attachmentUrl ?? null,
      attachmentType: input.attachmentType ?? null
    }).returning()
    return { visitor: visitor!, conversation, message: message!, isNew }
  })
  const { visitor, conversation, message, isNew } = result

  // broadcast
  const wsChannel = channels.workspace(input.workspaceId)
  const convChannel = channels.conversation(conversation.id)
  if (isNew) {
    publish(wsChannel, { type: 'conversation.new', payload: serializeConversation(conversation) })
  } else {
    publish(wsChannel, {
      type: 'conversation.updated',
      payload: {
        id: conversation.id,
        status: conversation.status,
        assigned_agent_id: conversation.assignedAgentId,
        last_message_at: conversation.lastMessageAt.toISOString()
      }
    })
  }
  const msgEvent = { type: 'message.new' as const, payload: serializeMessage(message) }
  // scope the inbox copy so agents don't receive chats assigned to someone else
  publishFiltered(wsChannel, msgEvent, inboxScope(conversation.assignedAgentId))
  publishConversationEvent(convChannel, msgEvent, conversation.assignedAgentId)

  // outbound webhooks (fire-and-forget, after the committed writes)
  if (isNew) {
    dispatchWebhooks(input.workspaceId, 'conversation.created', {
      conversation: serializeConversation(conversation),
      visitor: { id: visitor.id, name: visitor.name, email: visitor.email }
    })
  }
  dispatchWebhooks(input.workspaceId, 'message.created', { message: serializeMessage(message) })

  return { visitor, conversation, message }
}

/**
 * Predicate for inbox broadcasts: admins see all; agents only receive the
 * unassigned pool + conversations assigned to them (§ agent visibility).
 */
export function inboxScope(assignedAgentId: string | null) {
  return (ctx: Record<string, unknown>) =>
    ctx.memberRole === 'admin' || assignedAgentId == null || ctx.memberId === assignedAgentId
}

/* agent → visitor */

interface AgentMessageInput {
  conversationId: string
  workspaceId: string
  senderMemberId: string
  content: string
  attachmentUrl?: string | null
  attachmentType?: string | null
  isInternalNote?: boolean
}

export async function addAgentMessage(input: AgentMessageInput) {
  const db = useDb()
  const now = new Date()

  const { message, conv } = await db.transaction(async (tx) => {
    const [conv] = await tx.update(conversations)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(eq(conversations.id, input.conversationId))
      .returning()
    if (!conv) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
    const [message] = await tx.insert(messages).values({
      conversationId: input.conversationId,
      senderType: 'agent',
      senderId: input.senderMemberId,
      content: input.content,
      attachmentUrl: input.attachmentUrl ?? null,
      attachmentType: input.attachmentType ?? null,
      isInternalNote: input.isInternalNote ?? false
    }).returning()
    return { message: message!, conv }
  })

  const event = { type: 'message.new' as const, payload: serializeMessage(message) }
  // inbox copy scoped to the assigned agent + admins
  publishFiltered(channels.workspace(input.workspaceId), event, inboxScope(conv.assignedAgentId))
  // on the shared conversation channel, keep internal notes away from the visitor (§4)
  publishConversationEvent(
    channels.conversation(input.conversationId), event, conv.assignedAgentId,
    { agentsOnly: message.isInternalNote }
  )

  // internal notes never leave the building — not even as webhooks
  if (!message.isInternalNote) {
    dispatchWebhooks(input.workspaceId, 'message.created', { message: serializeMessage(message) })
  }

  return message
}

/* agent-initiated conversations (live roster outreach) */

interface StartConversationInput {
  workspaceId: string
  visitorRef: string
  memberId: string
  memberRole: 'admin' | 'agent'
  content: string
}

/**
 * An agent reaches out first (from the live visitor roster). Reuses the
 * visitor's active thread when one exists (claiming it for the sender if
 * unassigned); otherwise creates an `open` conversation pre-assigned to the
 * sender. The visitor's live widget is told via `conversation.started`.
 */
export async function startAgentConversation(input: StartConversationInput) {
  const db = useDb()
  const now = new Date()
  const result = await db.transaction(async (tx) => {
    // This row lock serializes agent and visitor starts for one visitor.
    const [visitor] = await tx.update(visitors).set({ lastSeenAt: now })
      .where(and(eq(visitors.id, input.visitorRef), eq(visitors.workspaceId, input.workspaceId)))
      .returning()
    if (!visitor) throw createError({ statusCode: 404, statusMessage: 'Visitor not found' })

    const existing = await tx.query.conversations.findFirst({
      where: and(eq(conversations.visitorRef, input.visitorRef), ne(conversations.status, 'resolved')),
      orderBy: [desc(conversations.lastMessageAt)]
    })
    if (existing?.assignedAgentId && existing.assignedAgentId !== input.memberId && input.memberRole !== 'admin') {
      throw createError({ statusCode: 403, statusMessage: 'This conversation is assigned to another agent' })
    }

    let conversation: Conversation
    const isNew = !existing
    if (existing) {
      const [updated] = await tx.update(conversations).set({
        assignedAgentId: existing.assignedAgentId ?? input.memberId,
        status: 'open',
        lastMessageAt: now,
        updatedAt: now
      }).where(eq(conversations.id, existing.id)).returning()
      conversation = updated!
    } else {
      const [created] = await tx.insert(conversations).values({
        workspaceId: input.workspaceId,
        visitorRef: input.visitorRef,
        assignedAgentId: input.memberId,
        status: 'open',
        lastMessageAt: now
      }).returning()
      conversation = created!
    }
    const [message] = await tx.insert(messages).values({
      conversationId: conversation.id,
      senderType: 'agent',
      senderId: input.memberId,
      content: input.content
    }).returning()
    return { visitor, conversation, message: message!, isNew }
  })
  const { visitor, conversation, message, isNew } = result

  const msgEvent = { type: 'message.new' as const, payload: serializeMessage(message) }
  if (isNew) {
    publish(channels.workspace(input.workspaceId), { type: 'conversation.new', payload: serializeConversation(conversation) })
    dispatchWebhooks(input.workspaceId, 'conversation.created', {
      conversation: serializeConversation(conversation),
      visitor: { id: visitor.id, name: visitor.name, email: visitor.email }
    })
  } else {
    publishConversationUpdate(conversation)
  }
  publishFiltered(channels.workspace(input.workspaceId), msgEvent, inboxScope(conversation.assignedAgentId))
  publishConversationEvent(channels.conversation(conversation.id), msgEvent, conversation.assignedAgentId)
  dispatchWebhooks(input.workspaceId, 'message.created', { message: serializeMessage(message) })

  // tell the visitor's live widget to adopt the thread (no-op if they left)
  sendToVisitor(input.workspaceId, input.visitorRef, {
    type: 'conversation.started',
    payload: { conversation: serializeConversation(conversation), message: serializeMessage(message) }
  })

  return { conversation, message }
}

/* assignment (§6.4 claim race) */

interface ClaimResult {
  ok: boolean
  conversation?: Conversation
  assignedAgentId?: string | null
}

/**
 * Claim an unassigned conversation. The atomic conditional UPDATE is what
 * prevents two agents from owning the same chat — first writer wins.
 */
export async function claimConversation(conversationId: string, workspaceId: string, memberId: string): Promise<ClaimResult> {
  const db = useDb()

  const rows = await db.update(conversations)
    .set({ assignedAgentId: memberId, status: 'open', updatedAt: new Date() })
    .where(and(eq(conversations.id, conversationId), eq(conversations.status, 'unassigned')))
    .returning()

  if (rows.length === 1) {
    const conversation = rows[0]!
    publishConversationUpdate(conversation)
    return { ok: true, conversation }
  }

  // lost the race — report the current owner
  const current = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) })
  return { ok: false, assignedAgentId: current?.assignedAgentId ?? null }
}

export async function assignConversation(conversationId: string, memberId: string): Promise<Conversation | null> {
  const db = useDb()
  const [conversation] = await db.update(conversations)
    .set({ assignedAgentId: memberId, status: 'open', updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
    .returning()
  if (conversation) publishConversationUpdate(conversation)
  return conversation ?? null
}

export async function setConversationStatus(conversationId: string, status: 'open' | 'resolved'): Promise<Conversation | null> {
  const db = useDb()
  const [conversation] = await db.update(conversations)
    .set({ status, resolvedAt: status === 'resolved' ? new Date() : null, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
    .returning()
  if (conversation) {
    publishConversationUpdate(conversation)
    if (status === 'resolved') {
      dispatchWebhooks(conversation.workspaceId, 'conversation.resolved', {
        conversation: serializeConversation(conversation)
      })
    }
  }
  return conversation ?? null
}

function publishConversationUpdate(c: Conversation) {
  const payload = {
    id: c.id,
    status: c.status,
    assigned_agent_id: c.assignedAgentId,
    last_message_at: c.lastMessageAt.toISOString()
  }
  publish(channels.workspace(c.workspaceId), { type: 'conversation.updated', payload })
  publishConversationEvent(channels.conversation(c.id), { type: 'conversation.updated', payload }, c.assignedAgentId)
}
