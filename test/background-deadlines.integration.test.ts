import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import { eq } from '@perch/db'
import * as schema from '@@/packages/db/src/schema'
import * as databaseClient from '@@/server/database/client'
import * as sweeps from '@@/server/infrastructure/background-sweep'
import { nextAttachmentCleanupAt } from '@@/server/domains/attachments/lifecycle'
import { nextAutomationAt, runAutomationSweep } from '@@/server/domains/automations/engine'
import { nextBillingReconciliationAt } from '@@/server/domains/billing/subscriptions'
import { nextResendSuppressionAt } from '@@/server/domains/notifications/resend-events'
import { nextUnansweredReminderAt, runUnansweredReminderSweep } from '@@/server/domains/notifications/unanswered-reminders'
import { nextWebhookDeliveryAt, enqueueWebhookEvent, runWebhookDeliverySweep } from '@@/server/domains/webhooks/delivery'
import { isWithinBusinessHours } from '@@/server/utils/business-hours'
import { publishConversationEvent } from '@@/server/utils/realtime'
import { PERCH_PRO_PLAN } from '@perch/shared'
import { getTestDatabaseUrl } from '@@/test/helpers/database'

const databaseUrl = getTestDatabaseUrl()

describe.skipIf(!databaseUrl)('durable background deadlines', () => {
  const client = postgres(databaseUrl!, { max: 2 })
  const db = drizzle(client, { schema })
  const userId = randomUUID()
  const workspaceId = randomUUID()
  const memberId = randomUUID()
  const visitorId = randomUUID()
  const conversationId = randomUUID()
  const messageId = randomUUID()
  const providerMessageId = randomUUID()
  const now = new Date('2026-09-16T10:00:00Z')
  const later = new Date('2026-09-16T11:00:00Z')

  beforeAll(async () => {
    vi.spyOn(databaseClient, 'useDb').mockReturnValue(db)
    vi.stubGlobal('useRuntimeConfig', () => ({ bachsEnvironment: 'sandbox', bachsSecretKey: 'sk_sandbox_test', bachsWebhookSecret: 'whsec_test', publicBaseUrl: 'https://useperch.xyz' }))
    vi.stubGlobal('isWithinBusinessHours', isWithinBusinessHours)
    vi.stubGlobal('publishFiltered', () => {})
    vi.stubGlobal('publish', () => {})
    vi.stubGlobal('publishConversationEvent', publishConversationEvent)
    // Cleanup jobs intentionally outlive workspace deletion in other suites.
    // Global sweeper tests run serially against an isolated test database.
    await db.delete(schema.attachmentAssets)
  })

  beforeEach(async () => {
    await db.insert(schema.users).values({ id: userId, name: 'Test Agent', email: `${userId}@example.test` })
    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'Idle tests', siteId: randomUUID(), unansweredReminderEnabled: true })
    await db.insert(schema.workspaceMembers).values({ id: memberId, workspaceId, userId, role: 'admin' })
    await db.insert(schema.visitors).values({ id: visitorId, workspaceId, visitorId: randomUUID() })
    await db.insert(schema.conversations).values({ id: conversationId, workspaceId, visitorRef: visitorId, status: 'open', assignedAgentId: memberId, lastMessageAt: now })
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await db.delete(schema.attachmentAssets).where(eq(schema.attachmentAssets.workspaceId, workspaceId))
    await db.delete(schema.resendSuppressionEvents).where(eq(schema.resendSuppressionEvents.providerMessageId, providerMessageId))
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
    await db.delete(schema.users).where(eq(schema.users.id, userId))
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await client.end()
  })

  it('has no deadlines when there is no actionable work', async () => {
    expect(await nextAttachmentCleanupAt()).toBeNull()
    expect(await nextAutomationAt()).toBeNull()
    expect(await nextBillingReconciliationAt()).toBeNull()
    expect(await nextResendSuppressionAt()).toBeNull()
    expect(await nextUnansweredReminderAt(now)).toBeNull()
    expect(await nextWebhookDeliveryAt()).toBeNull()
  })

  it('preserves payment reconciliation deadlines and stale claims, ignoring terminal jobs', async () => {
    await db.insert(schema.billingReconciliationJobs).values({ workspaceId, nextAttemptAt: later })
    expect(await nextBillingReconciliationAt()).toEqual(later)
    await db.update(schema.billingReconciliationJobs).set({ status: 'processing', claimedAt: now }).where(eq(schema.billingReconciliationJobs.workspaceId, workspaceId))
    expect(await nextBillingReconciliationAt()).toEqual(new Date(now.getTime() + 10 * 60_000))
    await db.update(schema.billingReconciliationJobs).set({ status: 'failed' }).where(eq(schema.billingReconciliationJobs.workspaceId, workspaceId))
    expect(await nextBillingReconciliationAt()).toBeNull()
  })

  it('schedules abandoned uploads, cleanup retries and final-attempt crash recovery', async () => {
    const [asset] = await db.insert(schema.attachmentAssets).values({
      workspaceId, uploaderUserId: userId, kind: 'message', publicId: randomUUID(),
      secureUrl: `https://example.test/${randomUUID()}.png`, mimeType: 'image/png', byteSize: 10, createdAt: now
    }).returning()
    expect(await nextAttachmentCleanupAt()).toEqual(new Date(now.getTime() + 24 * 60 * 60_000))
    await db.update(schema.attachmentAssets).set({ state: 'retrying', cleanupNextAttemptAt: later }).where(eq(schema.attachmentAssets.id, asset!.id))
    expect(await nextAttachmentCleanupAt()).toEqual(later)
    await db.update(schema.attachmentAssets).set({ state: 'processing', cleanupLockedAt: now, cleanupAttempts: 5 }).where(eq(schema.attachmentAssets.id, asset!.id))
    expect(await nextAttachmentCleanupAt()).toEqual(new Date(now.getTime() + 10 * 60_000))
    await db.update(schema.attachmentAssets).set({ state: 'dead_letter' }).where(eq(schema.attachmentAssets.id, asset!.id))
    expect(await nextAttachmentCleanupAt()).toBeNull()
  })

  it('ignores already processed suppression events', async () => {
    await db.insert(schema.resendSuppressionEvents).values({ providerMessageId, reason: 'bounce', nextAttemptAt: later })
    expect(await nextResendSuppressionAt()).toEqual(later)
    await db.update(schema.resendSuppressionEvents).set({ status: 'processed' }).where(eq(schema.resendSuppressionEvents.providerMessageId, providerMessageId))
    expect(await nextResendSuppressionAt()).toBeNull()
  })

  it('schedules future unanswered messages and snoozes, then sleeps after delivery', async () => {
    await db.insert(schema.messages).values({ id: messageId, conversationId, senderType: 'visitor', content: 'Question', createdAt: now })
    expect(await nextUnansweredReminderAt(now)).toEqual(new Date(now.getTime() + PERCH_PRO_PLAN.freeReminderMinutes * 60_000))
    const snooze = new Date('2026-09-17T10:00:00Z')
    await db.update(schema.conversations).set({ snoozedUntil: snooze }).where(eq(schema.conversations.id, conversationId))
    expect(await nextUnansweredReminderAt(now)).toEqual(snooze)
    const sender = vi.fn().mockResolvedValue(true)
    await runUnansweredReminderSweep({ now: snooze, sender })
    expect(sender).toHaveBeenCalledTimes(1)
    expect(await nextUnansweredReminderAt(snooze)).toBeNull()
    await runUnansweredReminderSweep({ now: snooze, sender })
    expect(sender).toHaveBeenCalledTimes(1)
  })

  it('uses paid reminder settings and recalculates at subscription expiry', async () => {
    await db.insert(schema.messages).values({ id: messageId, conversationId, senderType: 'visitor', content: 'Question', createdAt: now })
    const reference = randomUUID()
    await db.insert(schema.workspaceInvoices).values({ workspaceId, reference, status: 'paid', interval: 'monthly', amountCents: 900, periodStart: now, periodEnd: later })
    await db.insert(schema.workspaceSubscriptions).values({ workspaceId, status: 'active', currentPeriodEnd: later, lastInvoiceReference: reference })
    await db.update(schema.workspaces).set({ unansweredReminderDelayMinutes: 5 }).where(eq(schema.workspaces.id, workspaceId))
    expect(await nextUnansweredReminderAt(now)).toEqual(new Date(now.getTime() + 5 * 60_000))
    await db.update(schema.workspaces).set({ unansweredReminderDelayMinutes: 120 }).where(eq(schema.workspaces.id, workspaceId))
    expect(await nextUnansweredReminderAt(now)).toEqual(later)
  })

  it('keeps checking normally when a capped candidate batch cannot prove the earliest deadline', async () => {
    const visitors = await db.insert(schema.visitors).values(Array.from({ length: 250 }, () => ({
      workspaceId, visitorId: randomUUID()
    }))).returning({ id: schema.visitors.id })
    const conversations = await db.insert(schema.conversations).values(visitors.map(visitor => ({
      workspaceId, visitorRef: visitor.id, assignedAgentId: memberId,
      snoozedUntil: new Date('2026-10-01T00:00:00Z')
    }))).returning({ id: schema.conversations.id })
    await db.insert(schema.messages).values(conversations.map(conversation => ({
      conversationId: conversation.id, senderType: 'visitor' as const, content: 'Pending', createdAt: now
    })))
    expect(await nextUnansweredReminderAt(now)).toEqual(now)
  })

  it('schedules reminder retries and stale locks without re-enqueuing terminal deliveries', async () => {
    await db.insert(schema.messages).values({ id: messageId, conversationId, senderType: 'visitor', content: 'Question', createdAt: now })
    const [delivery] = await db.insert(schema.unansweredReminderDeliveries).values({ workspaceId, conversationId, visitorMessageId: messageId, recipientMemberId: memberId, status: 'failed', attempts: 1, nextAttemptAt: later }).returning()
    expect(await nextUnansweredReminderAt(now)).toEqual(later)
    await db.update(schema.unansweredReminderDeliveries).set({ status: 'processing', lockedAt: now }).where(eq(schema.unansweredReminderDeliveries.id, delivery!.id))
    expect(await nextUnansweredReminderAt(now)).toEqual(new Date(now.getTime() + 10 * 60_000))
    await db.update(schema.unansweredReminderDeliveries).set({ status: 'failed', attempts: 5 }).where(eq(schema.unansweredReminderDeliveries.id, delivery!.id))
    expect(await nextUnansweredReminderAt(now)).toBeNull()
  })

  it('schedules inactivity rules, respects snoozes and excludes completed reminders', async () => {
    const [rule] = await db.insert(schema.automationRules).values({ workspaceId, requestKey: randomUUID(), name: 'Remind', type: 'inactivity_reminder', config: { minutes: 5 } }).returning()
    expect(await nextAutomationAt()).toEqual(new Date(now.getTime() + 5 * 60_000))
    await db.update(schema.conversations).set({ snoozedUntil: later }).where(eq(schema.conversations.id, conversationId))
    expect(await nextAutomationAt()).toEqual(later)
    await runAutomationSweep(later)
    expect(await nextAutomationAt()).toBeNull()
    await db.update(schema.automationRules).set({ type: 'auto_close', config: { hours: 2 } }).where(eq(schema.automationRules.id, rule!.id))
    expect(await nextAutomationAt()).toEqual(new Date(now.getTime() + 2 * 60 * 60_000))
    await db.update(schema.automationRules).set({ enabled: false }).where(eq(schema.automationRules.id, rule!.id))
    expect(await nextAutomationAt()).toBeNull()
  })

  it('schedules webhooks and retry leases, then sleeps after successful delivery', async () => {
    await db.insert(schema.webhookEndpoints).values({ workspaceId, url: 'https://example.test/hook', secret: 'test-secret', events: ['message.created'] })
    await db.transaction(tx => enqueueWebhookEvent(tx, workspaceId, 'message.created', { message: { id: messageId } }, randomUUID(), { enabled: true }))
    await db.update(schema.webhookJobs).set({ nextAttemptAt: later }).where(eq(schema.webhookJobs.workspaceId, workspaceId))
    expect(await nextWebhookDeliveryAt()).toEqual(later)
    await db.update(schema.webhookJobs).set({ status: 'processing', lockedAt: now }).where(eq(schema.webhookJobs.workspaceId, workspaceId))
    expect(await nextWebhookDeliveryAt()).toEqual(new Date(now.getTime() + 10 * 60_000))
    const transport = vi.fn().mockResolvedValue(204)
    await runWebhookDeliverySweep({ db, now: later, transport })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(await nextWebhookDeliveryAt()).toBeNull()
  })

  it('wakes webhook delivery when auto-close commits new work without an HTTP request', async () => {
    vi.stubEnv('PERCH_WEBHOOK_DELIVERY_ENABLED', 'true')
    const wake = vi.spyOn(sweeps, 'wakeBackgroundSweeps')
    await db.insert(schema.webhookEndpoints).values({ workspaceId, url: 'https://example.test/hook', secret: 'test-secret', events: ['conversation.resolved'] })
    await db.insert(schema.automationRules).values({ workspaceId, requestKey: randomUUID(), name: 'Close', type: 'auto_close', config: { hours: 1 } })
    await runAutomationSweep(later)
    expect(wake).toHaveBeenCalledTimes(1)
    const conversation = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, conversationId) })
    expect(conversation?.status).toBe('resolved')
    expect(await nextWebhookDeliveryAt()).not.toBeNull()
    wake.mockRestore()
  })
})
