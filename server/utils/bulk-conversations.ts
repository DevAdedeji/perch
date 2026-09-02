import {
  and,
  asc,
  conversationTags,
  conversations,
  eq,
  inArray,
  memberNotifications,
  supportOutcomeEvents,
  tags,
  workspaceMembers
} from '@perch/db'
import type { Conversation, Database, MemberNotification, WorkspaceMember } from '@perch/db'
import { MAX_BULK_CONVERSATIONS } from '@perch/shared'
import { z } from 'zod'
import { serializeConversation } from './conversations'
import { enqueueWebhookEvent } from './webhooks'

const conversationIds = z.array(z.string().uuid())
  .min(1)
  .max(MAX_BULK_CONVERSATIONS)
  .transform(ids => [...new Set(ids)])

export const bulkConversationActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), conversation_ids: conversationIds, member_id: z.string().uuid() }).strict(),
  z.object({ action: z.literal('resolve'), conversation_ids: conversationIds }).strict(),
  z.object({ action: z.literal('reopen'), conversation_ids: conversationIds }).strict(),
  z.object({ action: z.literal('add_tag'), conversation_ids: conversationIds, tag_id: z.string().uuid() }).strict(),
  z.object({ action: z.literal('remove_tag'), conversation_ids: conversationIds, tag_id: z.string().uuid() }).strict()
])

export type BulkConversationAction = z.infer<typeof bulkConversationActionSchema>

export interface BulkConversationActor {
  userId: string
  memberId: string
  name: string
}

export interface BulkConversationMutationResult {
  action: BulkConversationAction['action']
  requestedCount: number
  changedConversationIds: string[]
  conversations: Conversation[]
  assignmentChanges: Array<{ conversation: Conversation, previousAssignedAgentId: string | null }>
  notifications: MemberNotification[]
  newlyResolved: Conversation[]
}

export function canBulkAssignConversation(
  member: Pick<WorkspaceMember, 'id' | 'role'>,
  conversation: Pick<Conversation, 'assignedAgentId'>,
  targetMemberId: string
): boolean {
  if (member.role === 'admin') return true
  if (conversation.assignedAgentId === null) return targetMemberId === member.id
  return conversation.assignedAgentId === member.id
}

function canAccessConversation(
  member: Pick<WorkspaceMember, 'id' | 'role'>,
  conversation: Pick<Conversation, 'assignedAgentId' | 'collaboratorMemberIds'>
): boolean {
  return member.role === 'admin'
    || conversation.assignedAgentId === null
    || conversation.assignedAgentId === member.id
    || conversation.collaboratorMemberIds.includes(member.id)
}

export async function mutateConversationsInBulk(
  db: Database,
  workspaceId: string,
  actor: BulkConversationActor,
  input: BulkConversationAction
): Promise<BulkConversationMutationResult> {
  return db.transaction(async (tx) => {
    // Membership and conversation scope are read again under the transaction so
    // a role or assignment change between opening the inbox and clicking Apply
    // cannot authorize an operation from stale browser state.
    const currentMember = await tx.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.id, actor.memberId),
        eq(workspaceMembers.userId, actor.userId),
        eq(workspaceMembers.workspaceId, workspaceId)
      )
    })
    if (!currentMember) {
      throw createError({ statusCode: 403, statusMessage: 'You are no longer a member of this workspace' })
    }

    const selected = await tx.select().from(conversations)
      .where(and(eq(conversations.workspaceId, workspaceId), inArray(conversations.id, input.conversation_ids)))
      .orderBy(asc(conversations.id))
      .for('update')

    if (selected.length !== input.conversation_ids.length) {
      throw createError({ statusCode: 404, statusMessage: 'One or more conversations are no longer available' })
    }
    if (selected.some(conversation => !canAccessConversation(currentMember, conversation))) {
      throw createError({ statusCode: 403, statusMessage: 'You no longer have access to one or more selected conversations' })
    }
    if (selected.some(conversation => conversation.isSpam)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Restore spam conversations individually before applying bulk actions'
      })
    }

    const now = new Date()
    const changedConversationIds: string[] = []
    const updatedConversations: Conversation[] = []
    const assignmentChanges: BulkConversationMutationResult['assignmentChanges'] = []
    const notifications: MemberNotification[] = []
    const newlyResolved: Conversation[] = []

    if (input.action === 'assign') {
      const target = await tx.query.workspaceMembers.findFirst({
        where: and(eq(workspaceMembers.id, input.member_id), eq(workspaceMembers.workspaceId, workspaceId))
      })
      if (!target) {
        throw createError({ statusCode: 404, statusMessage: 'That agent is no longer in this workspace' })
      }
      if (selected.some(conversation => !canBulkAssignConversation(currentMember, conversation, target.id))) {
        throw createError({
          statusCode: 403,
          statusMessage: 'You can claim unassigned conversations for yourself or transfer conversations currently assigned to you'
        })
      }

      for (const previous of selected) {
        const needsChange = previous.assignedAgentId !== target.id || previous.status !== 'open'
        if (!needsChange) {
          updatedConversations.push(previous)
          continue
        }
        const [conversation] = await tx.update(conversations).set({
          assignedAgentId: target.id,
          status: 'open',
          resolvedAt: null,
          snoozedUntil: null,
          updatedAt: now
        }).where(and(eq(conversations.id, previous.id), eq(conversations.workspaceId, workspaceId))).returning()
        if (!conversation) throw createError({ statusCode: 409, statusMessage: 'A selected conversation changed. Refresh and try again.' })
        changedConversationIds.push(conversation.id)
        updatedConversations.push(conversation)
        assignmentChanges.push({ conversation, previousAssignedAgentId: previous.assignedAgentId })

        if (target.id !== actor.memberId && previous.assignedAgentId !== target.id) {
          const [notification] = await tx.insert(memberNotifications).values({
            workspaceId,
            recipientMemberId: target.id,
            actorMemberId: currentMember.id,
            actorName: actor.name,
            type: 'assignment',
            source: 'conversation',
            conversationId: conversation.id,
            excerpt: 'A conversation was assigned to you.'
          }).returning()
          if (notification) notifications.push(notification)
        }
      }
    } else if (input.action === 'resolve') {
      for (const previous of selected) {
        if (previous.status === 'resolved') {
          updatedConversations.push(previous)
          continue
        }
        const [conversation] = await tx.update(conversations).set({
          status: 'resolved',
          resolvedAt: now,
          snoozedUntil: null,
          updatedAt: now
        }).where(and(eq(conversations.id, previous.id), eq(conversations.workspaceId, workspaceId))).returning()
        if (!conversation) throw createError({ statusCode: 409, statusMessage: 'A selected conversation changed. Refresh and try again.' })
        await tx.insert(supportOutcomeEvents).values({
          workspaceId,
          conversationId: conversation.id,
          eventType: 'resolution',
          actorMemberId: currentMember.id,
          occurredAt: now
        })
        changedConversationIds.push(conversation.id)
        updatedConversations.push(conversation)
        newlyResolved.push(conversation)
        await enqueueWebhookEvent(tx, workspaceId, 'conversation.resolved', {
          conversation: serializeConversation(conversation)
        }, `conversation.resolved:${conversation.id}:${conversation.updatedAt.toISOString()}`)
      }
    } else if (input.action === 'reopen') {
      for (const previous of selected) {
        if (previous.status !== 'resolved') {
          updatedConversations.push(previous)
          continue
        }
        const [conversation] = await tx.update(conversations).set({
          status: previous.assignedAgentId ? 'open' : 'unassigned',
          resolvedAt: null,
          snoozedUntil: null,
          updatedAt: now
        }).where(and(eq(conversations.id, previous.id), eq(conversations.workspaceId, workspaceId))).returning()
        if (!conversation) throw createError({ statusCode: 409, statusMessage: 'A selected conversation changed. Refresh and try again.' })
        changedConversationIds.push(conversation.id)
        updatedConversations.push(conversation)
      }
    } else {
      const tag = await tx.query.tags.findFirst({
        where: and(eq(tags.id, input.tag_id), eq(tags.workspaceId, workspaceId))
      })
      if (!tag) throw createError({ statusCode: 404, statusMessage: 'That tag is no longer available' })

      if (input.action === 'add_tag') {
        const inserted = await tx.insert(conversationTags)
          .values(selected.map(conversation => ({ conversationId: conversation.id, tagId: tag.id })))
          .onConflictDoNothing()
          .returning({ conversationId: conversationTags.conversationId })
        changedConversationIds.push(...inserted.map(row => row.conversationId))
      } else {
        const removed = await tx.delete(conversationTags).where(and(
          inArray(conversationTags.conversationId, input.conversation_ids),
          eq(conversationTags.tagId, tag.id)
        )).returning({ conversationId: conversationTags.conversationId })
        changedConversationIds.push(...removed.map(row => row.conversationId))
      }
      updatedConversations.push(...selected)
    }

    return {
      action: input.action,
      requestedCount: input.conversation_ids.length,
      changedConversationIds,
      conversations: updatedConversations,
      assignmentChanges,
      notifications,
      newlyResolved
    }
  })
}
