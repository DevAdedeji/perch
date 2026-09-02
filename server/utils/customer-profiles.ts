import {
  and,
  conversations,
  count,
  desc,
  eq,
  isNull,
  ne,
  or,
  sql,
  tags,
  visitorReplyDeliveries,
  visitorTags,
  visitors,
  workspaces
} from '@perch/db'
import type { Conversation, WorkspaceMember } from '@perch/db'
import { parseClientContext } from './client-context'
import { isVisitorMessagingBlocked } from './spam-control'
import { z } from 'zod'

const nullableText = (max: number) => z.union([
  z.string().trim().max(max).transform(value => value || null),
  z.null()
]).optional()

export const customerProfileUpdateSchema = z.object({
  name: nullableText(100),
  email: z.union([
    z.string().trim().toLowerCase().email().max(200),
    z.literal('').transform(() => null),
    z.null()
  ]).optional(),
  company: nullableText(120),
  job_title: nullableText(120),
  internal_note: nullableText(2000),
  tag_ids: z.array(z.string().uuid()).max(20).refine(ids => new Set(ids).size === ids.length, {
    message: 'Customer tags cannot contain duplicates'
  }).optional(),
  expected_version: z.number().int().positive()
}).strict().refine(data => Object.keys(data).some(key => key !== 'expected_version'), {
  message: 'Nothing to update'
})

function historyAccess(member: WorkspaceMember) {
  if (member.role === 'admin') return undefined
  return or(
    isNull(conversations.assignedAgentId),
    eq(conversations.assignedAgentId, member.id),
    sql`${conversations.collaboratorMemberIds} @> ARRAY[${member.id}::uuid]`
  )
}

export async function getCustomerContext(conversation: Conversation, member: WorkspaceMember) {
  const db = useDb()
  const visitor = await db.query.visitors.findFirst({
    where: and(eq(visitors.id, conversation.visitorRef), eq(visitors.workspaceId, conversation.workspaceId))
  })
  if (!visitor) {
    throw createError({ statusCode: 404, statusMessage: 'Visitor not found' })
  }

  const historyWhere = and(
    eq(conversations.workspaceId, conversation.workspaceId),
    eq(conversations.visitorRef, visitor.id),
    ne(conversations.id, conversation.id),
    historyAccess(member)
  )
  const [pastRows, recent, profileTags, messagingBlocked, workspace, latestReplyDelivery] = await Promise.all([
    db.select({ total: count() }).from(conversations).where(historyWhere),
    db.select({
      id: conversations.id,
      status: conversations.status,
      lastMessageAt: conversations.lastMessageAt
    }).from(conversations).where(historyWhere).orderBy(desc(conversations.lastMessageAt)).limit(5),
    db.select({ id: tags.id, name: tags.name })
      .from(visitorTags)
      .innerJoin(tags, eq(tags.id, visitorTags.tagId))
      .where(and(eq(visitorTags.visitorId, visitor.id), eq(tags.workspaceId, conversation.workspaceId)))
      .orderBy(tags.name),
    isVisitorMessagingBlocked(visitor, db),
    db.query.workspaces.findFirst({ where: eq(workspaces.id, conversation.workspaceId) }),
    db.query.visitorReplyDeliveries.findFirst({
      where: eq(visitorReplyDeliveries.conversationId, conversation.id),
      orderBy: desc(visitorReplyDeliveries.createdAt)
    })
  ])

  const legacyContext = parseClientContext(visitor.metadata.ua)
  const browser = visitor.metadata.browser ?? (visitor.metadata.ua ? legacyContext.browser : null)
  const os = visitor.metadata.os ?? (visitor.metadata.ua ? legacyContext.os : null)
  return {
    visitor: {
      name: visitor.profileName ?? visitor.name,
      email: visitor.profileEmail ?? visitor.email,
      profile_name: visitor.profileName,
      profile_email: visitor.profileEmail,
      reported_name: visitor.name,
      reported_email: visitor.email,
      company: visitor.company,
      job_title: visitor.jobTitle,
      internal_note: visitor.internalNote,
      profile_version: visitor.profileVersion,
      tags: profileTags,
      visitor_id: visitor.visitorId,
      external_id: visitor.externalId,
      identity_verified: visitor.identityVerified,
      messaging_blocked: messagingBlocked,
      reply_email: {
        eligible: visitorReplyEmailFeatureEnabled()
          && !!workspace?.visitorReplyEmailEnabled
          && !!visitor.email
          && visitor.replyEmailEnabled
          && !!visitor.replyEmailConsentAt,
        status: latestReplyDelivery?.status ?? null,
        cancel_reason: latestReplyDelivery?.cancelReason ?? null
      },
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
    past_conversations: Number(pastRows[0]?.total ?? 0),
    recent_conversations: recent.map(item => ({
      id: item.id,
      status: item.status,
      last_message_at: item.lastMessageAt.toISOString()
    }))
  }
}
