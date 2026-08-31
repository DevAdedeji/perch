import {
  and,
  asc,
  automationExecutions,
  automationNotifications,
  automationRuleCursors,
  automationRules,
  conversationTags,
  conversations,
  eq,
  inArray,
  isNull,
  notExists,
  sql,
  supportOutcomeEvents,
  workspaceMembers
} from '@perch/db'
import type { AutomationRule, Conversation, Visitor } from '@perch/db'
import type { AutomationRuleConfig } from '@perch/shared'
import { channels } from '@perch/shared'

type Database = ReturnType<typeof useDb>
class AutomationSkipped extends Error {}

function entryExecutionKey(ruleId: string, conversationId: string) {
  return `entry:${ruleId}:${conversationId}`
}

export function inactivityExecutionKey(ruleId: string, conversationId: string, lastMessageAt: Date) {
  return `inactive:${ruleId}:${conversationId}:${lastMessageAt.toISOString()}`
}

export function reminderExecutionKey(ruleId: string, conversationId: string, memberId: string, lastMessageAt: Date) {
  return `reminder:${ruleId}:${conversationId}:${memberId}:${lastMessageAt.toISOString()}`
}

export function isInactivityCandidate(
  conversation: Pick<Conversation, 'status' | 'assignedAgentId' | 'lastMessageAt' | 'snoozedUntil'>,
  cutoff: Date,
  now: Date
) {
  return conversation.status === 'open'
    && conversation.assignedAgentId !== null
    && conversation.lastMessageAt <= cutoff
    && (!conversation.snoozedUntil || conversation.snoozedUntil <= now)
}

export function roundRobinIndex(cursor: number, memberCount: number) {
  if (!Number.isInteger(cursor) || cursor < 1 || !Number.isInteger(memberCount) || memberCount < 1) return null
  return (cursor - 1) % memberCount
}

type ConversationLoader = (id: string, workspaceId: string) => Promise<Conversation | null | undefined>

export async function resolveEntryConversation(
  fallback: Conversation,
  load: ConversationLoader = async (id, workspaceId) => useDb().query.conversations.findFirst({
    where: and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId))
  })
) {
  return await load(fallback.id, fallback.workspaceId) ?? fallback
}

async function claimExecution(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  rule: AutomationRule,
  conversationId: string,
  key: string,
  context: { activityAt?: Date, memberId?: string } = {}
) {
  const [execution] = await tx.insert(automationExecutions).values({
    ruleId: rule.id,
    conversationId,
    executionKey: key,
    activityAt: context.activityAt,
    memberId: context.memberId,
    detail: { type: rule.type }
  }).onConflictDoNothing().returning()
  return execution ?? null
}

async function applyDirectAssignment(rule: AutomationRule, conversation: Conversation, memberId: string) {
  return useDb().transaction(async (tx) => {
    const execution = await claimExecution(tx, rule, conversation.id, entryExecutionKey(rule.id, conversation.id))
    if (!execution) return null
    const target = await tx.query.workspaceMembers.findFirst({
      where: and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, conversation.workspaceId))
    })
    if (!target) {
      await tx.delete(automationExecutions).where(eq(automationExecutions.id, execution.id))
      return null
    }
    const [updated] = await tx.update(conversations).set({
      assignedAgentId: target.id,
      status: 'open',
      updatedAt: new Date()
    }).where(and(
      eq(conversations.id, conversation.id),
      eq(conversations.workspaceId, conversation.workspaceId),
      isNull(conversations.assignedAgentId),
      eq(conversations.status, 'unassigned')
    )).returning()
    if (!updated) await tx.delete(automationExecutions).where(eq(automationExecutions.id, execution.id))
    return updated ?? null
  })
}

async function applyRoundRobin(rule: AutomationRule, conversation: Conversation) {
  const configured = (rule.config as { member_ids: string[] }).member_ids
  const members = await useDb().select({ id: workspaceMembers.id }).from(workspaceMembers).where(and(
    eq(workspaceMembers.workspaceId, conversation.workspaceId),
    configured.length ? inArray(workspaceMembers.id, configured) : undefined
  )).orderBy(asc(workspaceMembers.id))
  if (!members.length) return null

  try {
    return await useDb().transaction(async (tx) => {
      const execution = await claimExecution(tx, rule, conversation.id, entryExecutionKey(rule.id, conversation.id))
      if (!execution) return null
      const [cursor] = await tx.insert(automationRuleCursors).values({
        ruleId: rule.id,
        nextIndex: 1,
        updatedAt: new Date()
      }).onConflictDoUpdate({
        target: automationRuleCursors.ruleId,
        set: { nextIndex: sql`${automationRuleCursors.nextIndex} + 1`, updatedAt: new Date() }
      }).returning({ nextIndex: automationRuleCursors.nextIndex })
      const target = members[roundRobinIndex(cursor!.nextIndex, members.length)!]!
      const [updated] = await tx.update(conversations).set({
        assignedAgentId: target.id,
        status: 'open',
        updatedAt: new Date()
      }).where(and(
        eq(conversations.id, conversation.id),
        eq(conversations.workspaceId, conversation.workspaceId),
        isNull(conversations.assignedAgentId),
        eq(conversations.status, 'unassigned')
      )).returning()
      if (!updated) throw new AutomationSkipped()
      return updated
    })
  } catch (error) {
    if (error instanceof AutomationSkipped) return null
    throw error
  }
}

async function applyVipTag(rule: AutomationRule, conversation: Conversation) {
  const tagId = (rule.config as { tag_id: string }).tag_id
  return useDb().transaction(async (tx) => {
    const execution = await claimExecution(tx, rule, conversation.id, entryExecutionKey(rule.id, conversation.id))
    if (!execution) return false
    const inserted = await tx.insert(conversationTags).values({ conversationId: conversation.id, tagId }).onConflictDoNothing().returning()
    return inserted.length > 0
  })
}

export async function runEntryAutomations(conversation: Conversation, visitor: Visitor) {
  let current = conversation
  let tagsChanged = false
  const rules = await getEnabledAutomationRules(conversation.workspaceId)
  for (const rule of rules) {
    try {
      if (rule.type === 'page_assignment' && !current.assignedAgentId) {
        const config = rule.config as Extract<AutomationRuleConfig, { url_contains: string }>
        if (matchesPageRule(config, visitor.metadata.page_url)) {
          current = await applyDirectAssignment(rule, current, config.member_id) ?? current
        }
      } else if (rule.type === 'round_robin' && !current.assignedAgentId) {
        current = await applyRoundRobin(rule, current) ?? current
      } else if (rule.type === 'vip_tagging') {
        const config = rule.config as Extract<AutomationRuleConfig, { condition: unknown }>
        if (matchesVipRule(config, visitor)) tagsChanged = await applyVipTag(rule, current) || tagsChanged
      }
    } catch (error) {
      console.error('[automation] entry rule failed', { ruleId: rule.id, conversationId: conversation.id, error })
    }
  }
  current = await resolveEntryConversation(current)
  return { conversation: current, tagsChanged }
}

async function runReminder(rule: AutomationRule, candidate: Conversation, now: Date) {
  const result = await useDb().transaction(async (tx) => {
    const [current] = await tx.update(conversations).set({
      updatedAt: sql`${conversations.updatedAt}`
    }).where(and(
      eq(conversations.id, candidate.id),
      eq(conversations.workspaceId, rule.workspaceId),
      eq(conversations.status, 'open'),
      sql`${conversations.assignedAgentId} is not null`,
      sql`(${conversations.snoozedUntil} is null or ${conversations.snoozedUntil} <= ${now.toISOString()}::timestamptz)`,
      sql`${conversations.lastMessageAt} = ${candidate.lastMessageAt.toISOString()}::timestamptz`
    )).returning()
    if (!current?.assignedAgentId) return null
    const execution = await claimExecution(
      tx,
      rule,
      current.id,
      reminderExecutionKey(rule.id, current.id, current.assignedAgentId, current.lastMessageAt),
      { activityAt: current.lastMessageAt, memberId: current.assignedAgentId }
    )
    if (!execution) return null
    const [notification] = await tx.insert(automationNotifications).values({
      workspaceId: current.workspaceId,
      memberId: current.assignedAgentId,
      conversationId: current.id,
      executionId: execution.id
    }).returning()
    return notification ?? null
  })
  if (!result) return
  publishFiltered(channels.workspace(candidate.workspaceId), {
    type: 'automation.reminder',
    payload: {
      notification_id: result.id,
      conversation_id: result.conversationId,
      created_at: result.createdAt.toISOString()
    }
  }, context => context.role === 'agent' && context.memberId === result.memberId)
}

async function runAutoClose(rule: AutomationRule, candidate: Conversation, cutoff: Date, now: Date) {
  const key = inactivityExecutionKey(rule.id, candidate.id, candidate.lastMessageAt)
  const closed = await useDb().transaction(async (tx) => {
    const execution = await claimExecution(tx, rule, candidate.id, key)
    if (!execution) return null
    const [updated] = await tx.update(conversations).set({
      status: 'resolved',
      resolvedAt: now,
      snoozedUntil: null,
      updatedAt: now
    }).where(and(
      eq(conversations.id, candidate.id),
      eq(conversations.workspaceId, candidate.workspaceId),
      eq(conversations.status, 'open'),
      sql`${conversations.assignedAgentId} is not null`,
      sql`(${conversations.snoozedUntil} is null or ${conversations.snoozedUntil} <= ${now.toISOString()}::timestamptz)`,
      sql`${conversations.lastMessageAt} <= ${cutoff.toISOString()}::timestamptz`
    )).returning()
    if (updated) {
      await tx.insert(supportOutcomeEvents).values({
        workspaceId: updated.workspaceId,
        conversationId: updated.id,
        eventType: 'resolution',
        occurredAt: now
      })
    } else {
      await tx.delete(automationExecutions).where(eq(automationExecutions.id, execution.id))
    }
    return updated ?? null
  })
  if (!closed) return
  publishConversationUpdate(closed)
  dispatchWebhooks(closed.workspaceId, 'conversation.resolved', { conversation: serializeConversation(closed) })
}

export async function runAutomationSweep(now = new Date()) {
  const rules = await useDb().query.automationRules.findMany({
    where: and(
      eq(automationRules.enabled, true),
      inArray(automationRules.type, ['inactivity_reminder', 'auto_close'])
    ),
    orderBy: [asc(automationRules.sortOrder), asc(automationRules.createdAt), asc(automationRules.id)]
  })
  for (const rule of rules) {
    const amount = rule.type === 'inactivity_reminder'
      ? (rule.config as { minutes: number }).minutes * 60_000
      : (rule.config as { hours: number }).hours * 3_600_000
    const cutoff = new Date(now.getTime() - amount)
    const previousReminder = useDb().select({ id: automationExecutions.id }).from(automationExecutions).where(and(
      eq(automationExecutions.ruleId, rule.id),
      eq(automationExecutions.conversationId, conversations.id),
      eq(automationExecutions.activityAt, conversations.lastMessageAt),
      eq(automationExecutions.memberId, conversations.assignedAgentId)
    ))
    const candidates = await useDb().query.conversations.findMany({
      where: and(
        eq(conversations.workspaceId, rule.workspaceId),
        eq(conversations.status, 'open'),
        sql`${conversations.assignedAgentId} is not null`,
        sql`(${conversations.snoozedUntil} is null or ${conversations.snoozedUntil} <= ${now.toISOString()}::timestamptz)`,
        rule.type === 'inactivity_reminder' ? notExists(previousReminder) : undefined,
        sql`${conversations.lastMessageAt} <= ${cutoff.toISOString()}::timestamptz`
      ),
      orderBy: asc(conversations.lastMessageAt),
      limit: 100
    })
    for (const conversation of candidates) {
      try {
        if (!isInactivityCandidate(conversation, cutoff, now)) continue
        if (rule.type === 'inactivity_reminder') await runReminder(rule, conversation, now)
        else await runAutoClose(rule, conversation, cutoff, now)
      } catch (error) {
        console.error('[automation] inactivity rule failed', { ruleId: rule.id, conversationId: conversation.id, error })
      }
    }
  }
}
