import { and, conversations, desc, eq, inArray, isNull, messages, ne, or, sql } from '@perch/db'
import type { Database } from '@perch/db'
import type { ConversationStatus } from '@perch/shared'
import type { ResponseSlaDTO } from '@perch/shared/models'
import { PERCH_PRO_PLAN } from '@perch/shared'

const APPROACHING_FRACTION = 0.25

export function effectiveResponseTargetMinutes(configuredMinutes: number, isPro: boolean) {
  return isPro ? configuredMinutes : PERCH_PRO_PLAN.freeReminderMinutes
}

interface ResponseSlaInput {
  conversationStatus: ConversationStatus
  snoozedUntil?: Date | null
  latestVisitorAt?: Date | string | null
  latestAgentAt?: Date | string | null
  targetMinutes: number
  now?: Date
}

/**
 * One response cycle starts at the newest public visitor message and ends at
 * the next public agent reply. Internal notes never enter these timestamps.
 */
export function calculateResponseSla(input: ResponseSlaInput): ResponseSlaDTO {
  const targetMinutes = Math.max(1, Math.trunc(input.targetMinutes))
  const visitorAt = input.latestVisitorAt ? new Date(input.latestVisitorAt) : null
  const agentAt = input.latestAgentAt ? new Date(input.latestAgentAt) : null
  const now = input.now ?? new Date()

  if (input.conversationStatus === 'resolved' || !visitorAt || (agentAt && agentAt >= visitorAt)) {
    return {
      status: 'answered',
      target_minutes: targetMinutes,
      started_at: null,
      approaching_at: null,
      due_at: null,
      paused_until: null
    }
  }

  const targetMs = targetMinutes * 60_000
  const dueAt = new Date(visitorAt.getTime() + targetMs)
  const approachingAt = new Date(dueAt.getTime() - targetMs * APPROACHING_FRACTION)
  const pausedUntil = input.snoozedUntil && input.snoozedUntil > now ? input.snoozedUntil : null

  let status: ResponseSlaDTO['status'] = 'due'
  if (pausedUntil) status = 'paused'
  else if (now >= dueAt) status = 'breached'
  else if (now >= approachingAt) status = 'approaching'

  return {
    status,
    target_minutes: targetMinutes,
    started_at: visitorAt.toISOString(),
    approaching_at: approachingAt.toISOString(),
    due_at: dueAt.toISOString(),
    paused_until: pausedUntil?.toISOString() ?? null
  }
}

const latestPublicVisitorAtExpression = sql<Date | string | null>`(
  select max(visitor_message.created_at)
  from messages visitor_message
  where visitor_message.conversation_id = ${conversations.id}
    and visitor_message.sender_type = 'visitor'
    and visitor_message.is_internal_note = false
)`

const latestPublicAgentAtExpression = sql<Date | string | null>`(
  select max(agent_message.created_at)
  from messages agent_message
  where agent_message.conversation_id = ${conversations.id}
    and agent_message.sender_type = 'agent'
    and agent_message.is_internal_note = false
)`

export async function responseSlaMessageTimes(db: Database, conversationIds: string[]) {
  if (!conversationIds.length) return new Map<string, { latestVisitorAt: Date | null, latestAgentAt: Date | null }>()
  const latest = (senderType: 'visitor' | 'agent') => db.selectDistinctOn([messages.conversationId], {
    conversationId: messages.conversationId,
    createdAt: messages.createdAt
  }).from(messages).where(and(
    inArray(messages.conversationId, conversationIds),
    eq(messages.senderType, senderType),
    eq(messages.isInternalNote, false)
  )).orderBy(messages.conversationId, desc(messages.createdAt), desc(messages.id))
  const [visitorRows, agentRows] = await Promise.all([latest('visitor'), latest('agent')])
  const result = new Map<string, { latestVisitorAt: Date | null, latestAgentAt: Date | null }>()
  for (const id of conversationIds) result.set(id, { latestVisitorAt: null, latestAgentAt: null })
  for (const row of visitorRows) result.get(row.conversationId)!.latestVisitorAt = row.createdAt
  for (const row of agentRows) result.get(row.conversationId)!.latestAgentAt = row.createdAt
  return result
}

/** Active, non-snoozed conversations whose newest visitor message is overdue. */
export function breachedResponseSlaCondition(targetMinutes: number) {
  return and(
    ne(conversations.status, 'resolved'),
    or(isNull(conversations.snoozedUntil), sql`${conversations.snoozedUntil} <= now()`),
    sql`${latestPublicVisitorAtExpression} is not null`,
    sql`(${latestPublicAgentAtExpression} is null or ${latestPublicAgentAtExpression} < ${latestPublicVisitorAtExpression})`,
    sql`${latestPublicVisitorAtExpression} + (${targetMinutes} * interval '1 minute') <= now()`
  )
}
