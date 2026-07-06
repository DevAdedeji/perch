import { and, conversations, eq, messages, visitors } from '@perch/db'
import type { Conversation, Message } from '@perch/db'
import { channels } from '@perch/shared'
import type { ConversationDTO, MessageDTO } from '@perch/shared'

/* ── serialization (rows → §6 wire DTOs) ─────────────────────────── */

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

/* ── visitor → business (used by the embed widget) ─────────────────── */

interface IncomingVisitorMessage {
  workspaceId: string
  visitorId: string
  name?: string | null
  email?: string | null
  content: string
  pageUrl?: string
}

/**
 * A visitor sends a message. Reuses the visitor's open conversation if one
 * exists (returning-visitor resume, §9), otherwise starts a new `unassigned`
 * one. Broadcasts `conversation.new`/`conversation.updated` + `message.new`.
 */
export async function ingestVisitorMessage(input: IncomingVisitorMessage) {
  const db = useDb()
  const now = new Date()

  // upsert the visitor (unique on workspace_id + visitor_id)
  const [visitor] = await db.insert(visitors).values({
    workspaceId: input.workspaceId,
    visitorId: input.visitorId,
    name: input.name ?? null,
    email: input.email ?? null,
    lastSeenAt: now,
    metadata: input.pageUrl ? { page_url: input.pageUrl } : {}
  }).onConflictDoUpdate({
    target: [visitors.workspaceId, visitors.visitorId],
    set: { lastSeenAt: now, ...(input.name ? { name: input.name } : {}) }
  }).returning()

  // resume an existing non-resolved conversation, else open a new one
  const existing = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.visitorRef, visitor!.id),
      eq(conversations.status, 'open')
    )
  }) ?? await db.query.conversations.findFirst({
    where: and(
      eq(conversations.visitorRef, visitor!.id),
      eq(conversations.status, 'unassigned')
    )
  })

  let conversation: Conversation
  let isNew = false
  if (existing) {
    const [updated] = await db.update(conversations)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(eq(conversations.id, existing.id))
      .returning()
    conversation = updated!
  } else {
    const [created] = await db.insert(conversations).values({
      workspaceId: input.workspaceId,
      visitorRef: visitor!.id,
      status: 'unassigned',
      lastMessageAt: now
    }).returning()
    conversation = created!
    isNew = true
  }

  const [message] = await db.insert(messages).values({
    conversationId: conversation.id,
    senderType: 'visitor',
    content: input.content
  }).returning()

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
  const msgEvent = { type: 'message.new' as const, payload: serializeMessage(message!) }
  publish(wsChannel, msgEvent)
  publish(convChannel, msgEvent)

  return { visitor: visitor!, conversation, message: message! }
}

/* ── agent → visitor ─────────────────────────────────────────────── */

interface AgentMessageInput {
  conversationId: string
  workspaceId: string
  senderMemberId: string
  content: string
  isInternalNote?: boolean
}

export async function addAgentMessage(input: AgentMessageInput) {
  const db = useDb()
  const now = new Date()

  const [message] = await db.insert(messages).values({
    conversationId: input.conversationId,
    senderType: 'agent',
    senderId: input.senderMemberId,
    content: input.content,
    isInternalNote: input.isInternalNote ?? false
  }).returning()

  await db.update(conversations)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(conversations.id, input.conversationId))

  const event = { type: 'message.new' as const, payload: serializeMessage(message!) }
  // agents always see it; the workspace channel is agent-only by construction
  publish(channels.workspace(input.workspaceId), event)
  // on the shared conversation channel, keep internal notes away from the visitor (§4)
  publish(channels.conversation(input.conversationId), event, { agentsOnly: message!.isInternalNote })

  return message!
}

/* ── assignment (§6.4 claim race) ────────────────────────────────── */

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
  if (conversation) publishConversationUpdate(conversation)
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
  publish(channels.conversation(c.id), { type: 'conversation.updated', payload })
}
