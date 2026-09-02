import { and, conversations, desc, eq, memberNotifications, messages, ne, sql, supportOutcomeEvents, triggerFires, triggers, visitors } from '@perch/db'
import type { Conversation, Message } from '@perch/db'
import { channels } from '@perch/shared'
import type { ConversationDTO, MessageDTO, VisitorConversationDTO, VisitorMessageDTO } from '@perch/shared'

/* serialization (rows → §6 wire DTOs) */

export function serializeConversation(c: Conversation): ConversationDTO {
  return {
    id: c.id,
    workspace_id: c.workspaceId,
    visitor_ref: c.visitorRef,
    assigned_agent_id: c.assignedAgentId,
    collaborator_member_ids: c.collaboratorMemberIds,
    status: c.status,
    priority: c.priority,
    snoozed_until: c.snoozedUntil?.toISOString() ?? null,
    last_message_at: c.lastMessageAt.toISOString(),
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
    resolved_at: c.resolvedAt ? c.resolvedAt.toISOString() : null,
    is_spam: c.isSpam
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
    mentioned_member_ids: m.mentionedMemberIds,
    created_at: m.createdAt.toISOString()
  }
}

export function serializeVisitorMessage(m: Message): VisitorMessageDTO {
  return {
    id: m.id,
    conversation_id: m.conversationId,
    sender_type: m.senderType,
    content: m.content,
    attachment_url: m.attachmentUrl,
    attachment_type: m.attachmentType,
    created_at: m.createdAt.toISOString()
  }
}

export function serializeVisitorConversation(c: Conversation): VisitorConversationDTO {
  return { id: c.id, status: c.status }
}

function publishConversationMessage(
  channel: string,
  message: Message,
  assignedAgentId: string | null,
  collaboratorMemberIds: string[]
) {
  publishConversationEvent(
    channel,
    { type: 'message.new', payload: serializeMessage(message) },
    assignedAgentId,
    collaboratorMemberIds,
    { agentsOnly: true }
  )
  if (!message.isInternalNote) {
    publishFiltered(channel, {
      type: 'visitor.message',
      payload: serializeVisitorMessage(message)
    }, context => context.role === 'visitor')
  }
}

/* visitor → business (used by the embed widget) */

interface IncomingVisitorMessage {
  workspaceId: string
  visitorId: string
  conversationId?: string
  name?: string | null
  email?: string | null
  replyEmailConsent?: boolean
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
      emailSource: input.email ? 'prechat' : null,
      emailUpdatedAt: input.email ? now : null,
      replyEmailEnabled: !!input.email && input.replyEmailConsent === true,
      replyEmailConsentAt: input.email && input.replyEmailConsent === true ? now : null,
      lastSeenAt: now,
      metadata: input.pageUrl ? { page_url: input.pageUrl } : {}
    }).onConflictDoUpdate({
      target: [visitors.workspaceId, visitors.visitorId],
      set: {
        lastSeenAt: now,
        ...(input.name ? { name: input.name } : {}),
        ...(input.email
          ? {
              email: input.email,
              emailSource: 'prechat' as const,
              emailUpdatedAt: now,
              replyEmailEnabled: input.replyEmailConsent === true,
              replyEmailConsentAt: input.replyEmailConsent === true ? now : null
            }
          : {}),
        ...(input.pageUrl
          ? { metadata: sql`coalesce(${visitors.metadata}, '{}'::jsonb) || ${JSON.stringify({ page_url: input.pageUrl })}::jsonb` }
          : {})
      }
    }).returning()

    await assertVisitorCanMessage(visitor!, tx)

    const existing = await tx.query.conversations.findFirst({
      where: input.conversationId
        ? and(eq(conversations.id, input.conversationId), eq(conversations.visitorRef, visitor!.id))
        : eq(conversations.visitorRef, visitor!.id),
      orderBy: [
        sql`case when ${conversations.status} = 'open' then 0 when ${conversations.status} = 'unassigned' then 1 else 2 end`,
        desc(conversations.lastMessageAt)
      ]
    })

    let conversation: Conversation
    let isNew = false
    if (input.conversationId && !existing) {
      throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
    }
    if (existing) {
      const [updated] = await tx.update(conversations).set({
        lastMessageAt: now,
        updatedAt: now,
        snoozedUntil: null,
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
  const { visitor, message, isNew } = result
  let conversation = result.conversation
  let automationTagsChanged = false
  try {
    const automated = await runEntryAutomations(conversation, visitor)
    conversation = automated.conversation
    automationTagsChanged = automated.tagsChanged
  } catch (error) {
    console.error('[automation] entry pass failed', { conversationId: conversation.id, error })
  }
  // broadcast
  const wsChannel = channels.workspace(input.workspaceId)
  const convChannel = channels.conversation(conversation.id)
  if (automationTagsChanged && !isNew) {
    publishFiltered(wsChannel, {
      type: 'conversation.refresh',
      payload: { conversation_id: conversation.id }
    }, inboxScope(conversation.assignedAgentId, conversation.collaboratorMemberIds))
  }
  if (isNew) {
    publishFiltered(
      wsChannel,
      { type: 'conversation.new', payload: serializeConversation(conversation) },
      inboxScope(conversation.assignedAgentId, conversation.collaboratorMemberIds)
    )
  } else {
    publishConversationUpdate(conversation, { previousAssignedAgentId: result.conversation.assignedAgentId })
  }
  const msgEvent = { type: 'message.new' as const, payload: serializeMessage(message) }
  // scope the inbox copy so agents don't receive chats assigned to someone else
  publishFiltered(wsChannel, msgEvent, inboxScope(conversation.assignedAgentId, conversation.collaboratorMemberIds))
  publishConversationMessage(convChannel, message, conversation.assignedAgentId, conversation.collaboratorMemberIds)

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
export function inboxScope(assignedAgentId: string | null, collaboratorMemberIds: string[] = []) {
  return (ctx: Record<string, unknown>) =>
    ctx.memberRole === 'admin'
    || assignedAgentId == null
    || ctx.memberId === assignedAgentId
    || collaboratorMemberIds.includes(ctx.memberId as string)
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
  mentionRecipientIds?: string[]
  actorName?: string
}

export async function addAgentMessage(input: AgentMessageInput) {
  const db = useDb()
  const now = new Date()

  const { message, conv, notifications, collaboratorsChanged } = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(conversations)
      .where(eq(conversations.id, input.conversationId)).for('update')
    if (!current) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
    if (current.isSpam && !input.isInternalNote) {
      throw createError({ statusCode: 409, statusMessage: 'Restore this conversation before replying' })
    }
    const collaboratorMemberIds = input.isInternalNote && input.mentionRecipientIds?.length
      ? [...new Set([...current.collaboratorMemberIds, ...input.mentionRecipientIds])]
      : current.collaboratorMemberIds
    const [conv] = await tx.update(conversations)
      .set({
        lastMessageAt: now,
        updatedAt: now,
        collaboratorMemberIds,
        ...(!input.isInternalNote ? { snoozedUntil: null } : {})
      })
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
      isInternalNote: input.isInternalNote ?? false,
      mentionedMemberIds: input.isInternalNote ? (input.mentionRecipientIds ?? []) : []
    }).returning()
    const notifications = message && input.isInternalNote && input.actorName && input.mentionRecipientIds?.length
      ? await tx.insert(memberNotifications).values(input.mentionRecipientIds.map(recipientMemberId => ({
          workspaceId: input.workspaceId,
          recipientMemberId,
          actorMemberId: input.senderMemberId,
          actorName: input.actorName!,
          type: 'mention' as const,
          source: 'conversation' as const,
          conversationId: input.conversationId,
          messageId: message.id,
          excerpt: input.content.slice(0, 160)
        }))).returning()
      : []
    return {
      message: message!,
      conv,
      notifications,
      collaboratorsChanged: collaboratorMemberIds.length !== current.collaboratorMemberIds.length
    }
  })

  const event = { type: 'message.new' as const, payload: serializeMessage(message) }
  if (collaboratorsChanged) publishConversationUpdate(conv)
  // inbox copy scoped to the assigned agent + admins
  publishFiltered(channels.workspace(input.workspaceId), event, inboxScope(conv.assignedAgentId, conv.collaboratorMemberIds))
  publishConversationMessage(channels.conversation(input.conversationId), message, conv.assignedAgentId, conv.collaboratorMemberIds)
  notifications.forEach(publishMemberNotification)

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
 * sender. The visitor's live widget is told via a visitor-safe start event.
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
    if (await isVisitorMessagingBlocked(visitor, tx)) {
      throw createError({ statusCode: 409, statusMessage: 'Messaging is disabled for this visitor' })
    }

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
        updatedAt: now,
        snoozedUntil: null
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
    return { visitor, conversation, message: message!, isNew, previousAssignedAgentId: existing?.assignedAgentId ?? null }
  })
  const { visitor, conversation, message, isNew, previousAssignedAgentId } = result

  const msgEvent = { type: 'message.new' as const, payload: serializeMessage(message) }
  if (isNew) {
    publishFiltered(
      channels.workspace(input.workspaceId),
      { type: 'conversation.new', payload: serializeConversation(conversation) },
      inboxScope(conversation.assignedAgentId, conversation.collaboratorMemberIds)
    )
    dispatchWebhooks(input.workspaceId, 'conversation.created', {
      conversation: serializeConversation(conversation),
      visitor: { id: visitor.id, name: visitor.name, email: visitor.email }
    })
  } else {
    publishConversationUpdate(conversation, { previousAssignedAgentId })
  }
  publishFiltered(channels.workspace(input.workspaceId), msgEvent, inboxScope(conversation.assignedAgentId, conversation.collaboratorMemberIds))
  publishConversationMessage(channels.conversation(conversation.id), message, conversation.assignedAgentId, conversation.collaboratorMemberIds)
  dispatchWebhooks(input.workspaceId, 'message.created', { message: serializeMessage(message) })

  // tell the visitor's live widget to adopt the thread (no-op if they left)
  sendToVisitor(input.workspaceId, input.visitorRef, {
    type: 'visitor.conversation.started',
    payload: {
      conversation: serializeVisitorConversation(conversation),
      message: serializeVisitorMessage(message)
    }
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
    publishConversationUpdate(conversation, { previousAssignedAgentId: null })
    return { ok: true, conversation }
  }

  // lost the race — report the current owner
  const current = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) })
  return { ok: false, assignedAgentId: current?.assignedAgentId ?? null }
}

export async function assignConversation(
  conversationId: string,
  memberId: string,
  actor: { memberId: string, name: string }
): Promise<Conversation | null> {
  const db = useDb()
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(conversations).where(eq(conversations.id, conversationId)).for('update')
    if (!current) return null
    if (current.assignedAgentId === memberId) {
      return { conversation: current, previousAssignedAgentId: current.assignedAgentId, notification: null }
    }
    const [conversation] = await tx.update(conversations)
      .set({ assignedAgentId: memberId, status: 'open', updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .returning()
    const [notification] = conversation && memberId !== actor.memberId
      ? await tx.insert(memberNotifications).values({
          workspaceId: conversation.workspaceId,
          recipientMemberId: memberId,
          actorMemberId: actor.memberId,
          actorName: actor.name,
          type: 'assignment',
          source: 'conversation',
          conversationId: conversation.id,
          excerpt: 'A conversation was assigned to you.'
        }).returning()
      : []
    return conversation
      ? { conversation, previousAssignedAgentId: current.assignedAgentId, notification: notification ?? null }
      : null
  })
  if (result && result.previousAssignedAgentId !== result.conversation.assignedAgentId) {
    publishConversationUpdate(result.conversation, { previousAssignedAgentId: result.previousAssignedAgentId })
    if (result.notification) publishMemberNotification(result.notification)
  }
  return result?.conversation ?? null
}

export function setConversationStatus(conversationId: string, status: 'open'): Promise<Conversation | null>
export function setConversationStatus(conversationId: string, status: 'resolved', actorMemberId: string): Promise<Conversation | null>
export async function setConversationStatus(
  conversationId: string,
  status: 'open' | 'resolved',
  actorMemberId?: string
): Promise<Conversation | null> {
  if (status === 'resolved' && !actorMemberId) {
    throw new Error('Resolving a conversation requires an acting workspace member')
  }

  const db = useDb()
  const now = new Date()
  const result = await db.transaction(async (tx) => {
    const [conversation] = await tx.update(conversations)
      .set({ status, resolvedAt: status === 'resolved' ? now : null, updatedAt: now, snoozedUntil: null })
      .where(status === 'resolved'
        ? and(eq(conversations.id, conversationId), ne(conversations.status, 'resolved'))
        : eq(conversations.id, conversationId))
      .returning()

    if (conversation && status === 'resolved') {
      await tx.insert(supportOutcomeEvents).values({
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        eventType: 'resolution',
        actorMemberId: actorMemberId!,
        occurredAt: now
      })
    }

    if (conversation) return { conversation, changed: true }
    if (status === 'resolved') {
      const current = await tx.query.conversations.findFirst({ where: eq(conversations.id, conversationId) })
      return { conversation: current ?? null, changed: false }
    }
    return { conversation: null, changed: false }
  })

  const conversation = result.conversation
  if (conversation && result.changed) {
    publishConversationUpdate(conversation)
    if (status === 'resolved') {
      dispatchWebhooks(conversation.workspaceId, 'conversation.resolved', {
        conversation: serializeConversation(conversation)
      })
    }
  }
  return conversation
}

export function inboxRemovalScope(
  previousAssignedAgentId: string | null,
  assignedAgentId: string | null,
  collaboratorMemberIds: string[] = []
) {
  return (ctx: Record<string, unknown>) => {
    if (ctx.role !== 'agent' || ctx.memberRole === 'admin') return false
    const isCollaborator = collaboratorMemberIds.includes(ctx.memberId as string)
    const wasVisible = previousAssignedAgentId === null || ctx.memberId === previousAssignedAgentId || isCollaborator
    const isVisible = assignedAgentId === null || ctx.memberId === assignedAgentId || isCollaborator
    return wasVisible && !isVisible
  }
}

export function publishConversationUpdate(c: Conversation, options: { previousAssignedAgentId?: string | null } = {}) {
  const payload = {
    id: c.id,
    status: c.status,
    assigned_agent_id: c.assignedAgentId,
    collaborator_member_ids: c.collaboratorMemberIds,
    priority: c.priority,
    snoozed_until: c.snoozedUntil?.toISOString() ?? null,
    last_message_at: c.lastMessageAt.toISOString(),
    is_spam: c.isSpam
  }
  const workspaceChannel = channels.workspace(c.workspaceId)
  publishFiltered(workspaceChannel, { type: 'conversation.updated', payload }, inboxScope(c.assignedAgentId, c.collaboratorMemberIds))
  if ('previousAssignedAgentId' in options && options.previousAssignedAgentId !== c.assignedAgentId) {
    publishFiltered(workspaceChannel, {
      type: 'conversation.removed',
      payload: { conversation_id: c.id }
    }, inboxRemovalScope(options.previousAssignedAgentId ?? null, c.assignedAgentId, c.collaboratorMemberIds))
  }
  publishConversationEvent(
    channels.conversation(c.id),
    { type: 'conversation.updated', payload },
    c.assignedAgentId,
    c.collaboratorMemberIds,
    { agentsOnly: true }
  )
  publishFiltered(channels.conversation(c.id), {
    type: 'conversation.status',
    payload: { conversation_id: c.id, status: c.status }
  }, context => context.role === 'visitor')
}
