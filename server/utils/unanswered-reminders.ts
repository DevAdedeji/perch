import { and, asc, conversations, eq, gt, inArray, lt, messages, or, sql, unansweredReminderDeliveries, users, visitors, workspaceMembers, workspaces } from '@perch/db'
import { PERCH_PRO_PLAN, PERCH_PRODUCTION_ORIGIN } from '@perch/shared'
import type { SubscriptionStatus } from '@perch/shared'
import { subscriptionHasPaidAccess, workspaceEntitlement } from './billing'

const MAX_ATTEMPTS = 5
const CLAIM_LIMIT = 25
const CANDIDATE_LIMIT = 250
const STALE_LOCK_MS = 10 * 60_000

export function reminderIsDue(messageAt: Date, delayMinutes: number, now = new Date()) {
  return messageAt.getTime() + delayMinutes * 60_000 <= now.getTime()
}

export function reminderRetryAt(attempt: number, now = new Date()) {
  const minutes = Math.min(360, 5 * 2 ** Math.max(0, attempt - 1))
  return new Date(now.getTime() + minutes * 60_000)
}

interface LatestVisitorCandidate {
  conversation_id: string
  workspace_id: string
  assigned_agent_id: string | null
  visitor_message_id: string
  message_at: Date | string
  reminder_delay: number
  business_hours_only: boolean
  business_hours: typeof workspaces.$inferSelect['businessHours']
  timezone: string | null
  subscription_status: SubscriptionStatus | null
  subscription_period_end: Date | string | null
}

export function effectiveReminderSettings(input: {
  delayMinutes: number
  businessHoursOnly: boolean
  isPro: boolean
}) {
  return {
    delayMinutes: input.isPro ? input.delayMinutes : PERCH_PRO_PLAN.freeReminderMinutes,
    businessHoursOnly: input.isPro && input.businessHoursOnly
  }
}

async function latestVisitorCandidates(now: Date) {
  const result = await useDb().execute(sql`
    with latest_public as (
      select m.id, m.conversation_id, m.sender_type, m.created_at,
        row_number() over (partition by m.conversation_id order by m.created_at desc, m.id desc) as row_number
      from messages m
      where m.is_internal_note = false
    )
    select c.id as conversation_id, c.workspace_id, c.assigned_agent_id,
      latest_public.id as visitor_message_id, latest_public.created_at as message_at,
      w.unanswered_reminder_delay_minutes as reminder_delay,
      w.unanswered_reminder_business_hours_only as business_hours_only,
      w.business_hours, w.timezone,
      s.status as subscription_status,
      s.current_period_end as subscription_period_end
    from latest_public
    join conversations c on c.id = latest_public.conversation_id
    join workspaces w on w.id = c.workspace_id
    left join workspace_subscriptions s on s.workspace_id = c.workspace_id
    where latest_public.row_number = 1
      and latest_public.sender_type = 'visitor'
      and w.unanswered_reminder_enabled = true
      and c.status in ('unassigned', 'open')
      and (c.snoozed_until is null or c.snoozed_until <= ${now.toISOString()}::timestamptz)
    order by latest_public.created_at asc
    limit ${CANDIDATE_LIMIT}
  `)
  return result as unknown as LatestVisitorCandidate[]
}

async function reminderRecipients(workspaceId: string, assignedAgentId: string | null) {
  return useDb().select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(assignedAgentId
      ? and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.id, assignedAgentId))
      : and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'admin')))
}

async function enqueueDueReminders(now: Date) {
  for (const candidate of await latestVisitorCandidates(now)) {
    const messageAt = new Date(candidate.message_at)
    const isPro = candidate.subscription_status
      ? subscriptionHasPaidAccess({
          status: candidate.subscription_status,
          currentPeriodEnd: candidate.subscription_period_end ? new Date(candidate.subscription_period_end) : null
        }, now)
      : false
    const settings = effectiveReminderSettings({
      delayMinutes: candidate.reminder_delay,
      businessHoursOnly: candidate.business_hours_only,
      isPro
    })
    if (!reminderIsDue(messageAt, settings.delayMinutes, now)) continue
    if (settings.businessHoursOnly && !isWithinBusinessHours(candidate.business_hours, candidate.timezone, now)) continue
    const recipients = await reminderRecipients(candidate.workspace_id, candidate.assigned_agent_id)
    if (!recipients.length) continue
    await useDb().insert(unansweredReminderDeliveries).values(recipients.map(recipient => ({
      workspaceId: candidate.workspace_id,
      conversationId: candidate.conversation_id,
      visitorMessageId: candidate.visitor_message_id,
      recipientMemberId: recipient.id,
      nextAttemptAt: now
    }))).onConflictDoNothing()
  }
}

async function claimDueReminders(now: Date) {
  return useDb().transaction(async (tx) => {
    const stale = new Date(now.getTime() - STALE_LOCK_MS)
    const rows = await tx.select().from(unansweredReminderDeliveries).where(and(
      lt(unansweredReminderDeliveries.attempts, MAX_ATTEMPTS),
      or(
        and(inArray(unansweredReminderDeliveries.status, ['pending', 'failed']), lt(unansweredReminderDeliveries.nextAttemptAt, new Date(now.getTime() + 1))),
        and(eq(unansweredReminderDeliveries.status, 'processing'), lt(unansweredReminderDeliveries.lockedAt, stale))
      )
    )).orderBy(asc(unansweredReminderDeliveries.nextAttemptAt)).limit(CLAIM_LIMIT).for('update', { skipLocked: true })
    if (!rows.length) return []
    return tx.update(unansweredReminderDeliveries).set({
      status: 'processing',
      lockedAt: now,
      attempts: sql`${unansweredReminderDeliveries.attempts} + 1`,
      updatedAt: sql`now()`
    }).where(inArray(unansweredReminderDeliveries.id, rows.map(row => row.id))).returning()
  })
}

async function stillNeedsReminder(delivery: typeof unansweredReminderDeliveries.$inferSelect, now: Date) {
  const [row] = await useDb().select({
    conversationStatus: conversations.status,
    assignedAgentId: conversations.assignedAgentId,
    recipientRole: workspaceMembers.role,
    snoozedUntil: conversations.snoozedUntil,
    messageAt: messages.createdAt,
    businessHoursOnly: workspaces.unansweredReminderBusinessHoursOnly,
    businessHours: workspaces.businessHours,
    timezone: workspaces.timezone
  }).from(unansweredReminderDeliveries)
    .innerJoin(conversations, eq(conversations.id, unansweredReminderDeliveries.conversationId))
    .innerJoin(messages, eq(messages.id, unansweredReminderDeliveries.visitorMessageId))
    .innerJoin(workspaces, eq(workspaces.id, unansweredReminderDeliveries.workspaceId))
    .innerJoin(workspaceMembers, eq(workspaceMembers.id, unansweredReminderDeliveries.recipientMemberId))
    .where(eq(unansweredReminderDeliveries.id, delivery.id)).limit(1)
  if (!row || !['unassigned', 'open'].includes(row.conversationStatus)) return { send: false, reschedule: false }
  if (row.assignedAgentId && row.assignedAgentId !== delivery.recipientMemberId) return { send: false, reschedule: false }
  if (!row.assignedAgentId && row.recipientRole !== 'admin') return { send: false, reschedule: false }
  if (row.snoozedUntil && row.snoozedUntil.getTime() > now.getTime()) return { send: false, reschedule: false }
  const [newer] = await useDb().select({ id: messages.id }).from(messages).where(and(
    eq(messages.conversationId, delivery.conversationId),
    eq(messages.isInternalNote, false),
    or(
      gt(messages.createdAt, row.messageAt),
      and(eq(messages.createdAt, row.messageAt), gt(messages.id, delivery.visitorMessageId))
    )
  )).limit(1)
  if (newer) return { send: false, reschedule: false }
  const entitlement = await workspaceEntitlement(delivery.workspaceId)
  if (entitlement.isPro && row.businessHoursOnly && !isWithinBusinessHours(row.businessHours, row.timezone, now)) {
    return { send: false, reschedule: true }
  }
  return { send: true, reschedule: false }
}

async function deliveryEmail(delivery: typeof unansweredReminderDeliveries.$inferSelect) {
  const [row] = await useDb().select({
    email: users.email,
    name: users.name,
    workspaceName: workspaces.name,
    visitorName: visitors.name,
    content: messages.content
  }).from(unansweredReminderDeliveries)
    .innerJoin(workspaceMembers, eq(workspaceMembers.id, unansweredReminderDeliveries.recipientMemberId))
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .innerJoin(workspaces, eq(workspaces.id, unansweredReminderDeliveries.workspaceId))
    .innerJoin(conversations, eq(conversations.id, unansweredReminderDeliveries.conversationId))
    .innerJoin(visitors, eq(visitors.id, conversations.visitorRef))
    .innerJoin(messages, eq(messages.id, unansweredReminderDeliveries.visitorMessageId))
    .where(eq(unansweredReminderDeliveries.id, delivery.id)).limit(1)
  return row
}

async function deliverReminder(
  delivery: typeof unansweredReminderDeliveries.$inferSelect,
  now: Date,
  sender: typeof sendEmail
) {
  const state = await stillNeedsReminder(delivery, now)
  if (!state.send) {
    await useDb().update(unansweredReminderDeliveries).set(state.reschedule
      ? { status: 'pending', lockedAt: null, nextAttemptAt: new Date(now.getTime() + 60 * 60_000), updatedAt: sql`now()` }
      : { status: 'canceled', lockedAt: null, updatedAt: sql`now()` }
    ).where(eq(unansweredReminderDeliveries.id, delivery.id))
    return
  }
  const detail = await deliveryEmail(delivery)
  if (!detail) {
    await useDb().update(unansweredReminderDeliveries).set({ status: 'canceled', lockedAt: null, updatedAt: sql`now()` })
      .where(eq(unansweredReminderDeliveries.id, delivery.id))
    return
  }
  const config = useRuntimeConfig()
  const origin = String(config.publicBaseUrl || process.env.PERCH_PUBLIC_URL || PERCH_PRODUCTION_ORIGIN).replace(/\/+$/, '')
  const excerpt = detail.content.length > 180 ? `${detail.content.slice(0, 177)}…` : detail.content
  const sent = await sender({
    to: detail.email,
    subject: `${detail.visitorName ?? 'A visitor'} is waiting for a reply`,
    html: emailLayout({
      title: 'A customer is waiting',
      body: `<p>Hi ${escapeHtml(detail.name)},</p><p><strong>${escapeHtml(detail.visitorName ?? 'A visitor')}</strong> sent a message to ${escapeHtml(detail.workspaceName)} and has not received a reply yet.</p><blockquote style="margin:16px 0;padding:10px 14px;border-left:3px solid #f59e0b;background:#f8fafc;color:#475569">${escapeHtml(excerpt)}</blockquote>`,
      ctaLabel: 'Reply in Perch',
      ctaUrl: `${origin}/dashboard?conversation=${encodeURIComponent(delivery.conversationId)}`
    })
  })
  if (!sent) throw new Error('Email provider did not accept the reminder')
  await useDb().update(unansweredReminderDeliveries).set({
    status: 'sent', sentAt: now, lockedAt: null, lastError: null, updatedAt: sql`now()`
  }).where(eq(unansweredReminderDeliveries.id, delivery.id))
}

export async function runUnansweredReminderSweep(options: { now?: Date, sender?: typeof sendEmail } = {}) {
  const now = options.now ?? new Date()
  await enqueueDueReminders(now)
  const deliveries = await claimDueReminders(now)
  for (const delivery of deliveries) {
    try {
      await deliverReminder(delivery, now, options.sender ?? sendEmail)
    } catch (error) {
      await useDb().update(unansweredReminderDeliveries).set({
        status: 'failed',
        lockedAt: null,
        nextAttemptAt: reminderRetryAt(delivery.attempts, now),
        lastError: String((error as Error)?.message ?? error).slice(0, 1000),
        updatedAt: sql`now()`
      }).where(eq(unansweredReminderDeliveries.id, delivery.id))
    }
  }
  return { processed: deliveries.length }
}
