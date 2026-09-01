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
  visitorTags,
  visitors
} from '@perch/db'
import type { Conversation, WorkspaceMember } from '@perch/db'
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

/** Best-effort labels only. The raw user agent never leaves the server. */
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
  const [pastRows, recent, profileTags, messagingBlocked] = await Promise.all([
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
    isVisitorMessagingBlocked(visitor, db)
  ])

  const { browser, os } = parseUa(visitor.metadata.ua)
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
