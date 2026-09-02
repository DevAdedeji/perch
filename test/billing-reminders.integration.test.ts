import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import * as schema from '../packages/db/src/schema'
import { eq } from '../packages/db/node_modules/drizzle-orm/index.js'
import { emailLayout, escapeHtml } from '../server/utils/email'
import { isWithinBusinessHours } from '../server/utils/business-hours'
import { applyWorkspaceSubscriptionState, workspaceEntitlement } from '../server/utils/billing'
import { reminderDeliveryIsActionable, runUnansweredReminderSweep } from '../server/utils/unanswered-reminders'
import { notificationChannelEnabled } from '../server/utils/notification-preferences'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('billing and reminder database integration', () => {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema })
  const userId = randomUUID()
  const workspaceId = randomUUID()
  const memberId = randomUUID()
  const visitorId = randomUUID()
  const conversationId = randomUUID()
  const messageId = randomUUID()

  beforeAll(async () => {
    Object.assign(globalThis, {
      useDb: () => db,
      useRuntimeConfig: () => ({ publicBaseUrl: 'https://useperch.xyz' }),
      emailLayout,
      escapeHtml,
      isWithinBusinessHours,
      notificationChannelEnabled,
      publishFiltered: () => {}
    })
    await db.insert(schema.users).values({ id: userId, email: `reminder-${userId}@example.com`, name: 'Reminder Agent' })
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Reminder Workspace',
      siteId: `ws_${randomUUID().replaceAll('-', '').slice(0, 10)}`,
      unansweredReminderEnabled: true,
      unansweredReminderDelayMinutes: 5
    })
    await db.insert(schema.workspaceMembers).values({ id: memberId, workspaceId, userId, role: 'admin' })
    await db.insert(schema.visitors).values({ id: visitorId, workspaceId, visitorId: `visitor_${randomUUID()}`, name: 'Waiting Visitor' })
    await db.insert(schema.conversations).values({ id: conversationId, workspaceId, visitorRef: visitorId })
    await db.insert(schema.messages).values({
      id: messageId,
      conversationId,
      senderType: 'visitor',
      content: 'Can somebody help me?',
      createdAt: new Date('2026-09-01T10:00:00Z')
    })
  })

  afterAll(async () => {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
    await db.delete(schema.users).where(eq(schema.users.id, userId))
    await client.end()
  })

  afterEach(async () => {
    await db.delete(schema.workspaceSubscriptions).where(eq(schema.workspaceSubscriptions.workspaceId, workspaceId))
    await db.delete(schema.workspaceInvoices).where(eq(schema.workspaceInvoices.workspaceId, workspaceId))
    await db.delete(schema.notificationPreferences).where(eq(schema.notificationPreferences.memberId, memberId))
  })

  it('delivers exactly one email for the same unanswered visitor message', async () => {
    const reference = `perch-test-${randomUUID()}`
    await db.insert(schema.workspaceInvoices).values({
      workspaceId,
      reference,
      status: 'paid',
      interval: 'monthly',
      amountCents: 900,
      bachsCheckoutId: `checkout_${randomUUID()}`,
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-10-01T00:00:00Z')
    })
    await applyWorkspaceSubscriptionState({
      id: `sub_${randomUUID()}`,
      status: 'active',
      current_period_end: '2026-10-01T00:00:00.000Z',
      metadata: { workspaceId, interval: 'monthly', perchPlan: 'workspace_pro', invoiceReference: reference },
      product: { id: 'product_monthly', metadata: { perch_plan: 'workspace_pro_monthly' } }
    })
    const sent: Array<{ to: string, subject: string }> = []
    const sender = async (message: { to: string, subject: string }) => {
      sent.push(message)
      return true
    }
    await runUnansweredReminderSweep({ now: new Date('2026-09-01T10:05:00Z'), sender })
    await runUnansweredReminderSweep({ now: new Date('2026-09-01T10:06:00Z'), sender })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ subject: 'Waiting Visitor is waiting for a reply' })
    const delivery = await db.query.unansweredReminderDeliveries.findFirst({
      where: eq(schema.unansweredReminderDeliveries.visitorMessageId, messageId)
    })
    expect(delivery?.status).toBe('sent')
  })

  it('activates workspace Pro only after payment and a provider-bounded subscription agree', async () => {
    expect((await workspaceEntitlement(workspaceId)).isPro).toBe(false)
    const reference = `perch-test-${randomUUID()}`
    await db.insert(schema.workspaceInvoices).values({
      workspaceId,
      reference,
      interval: 'monthly',
      amountCents: 900,
      bachsCheckoutId: `checkout_${randomUUID()}`,
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60_000)
    })
    await applyWorkspaceSubscriptionState({
      id: `sub_${randomUUID()}`,
      status: 'active',
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
      metadata: { workspaceId, interval: 'monthly', perchPlan: 'workspace_pro', invoiceReference: reference },
      product: { id: 'product_monthly', metadata: { perch_plan: 'workspace_pro_monthly' } }
    })
    expect((await workspaceEntitlement(workspaceId)).isPro).toBe(false)
    await db.update(schema.workspaceInvoices).set({ status: 'paid', paidAt: new Date() }).where(eq(schema.workspaceInvoices.reference, reference))
    expect((await workspaceEntitlement(workspaceId)).isPro).toBe(true)
  })

  it('cancels an unanswered reminder when the recipient disables personal email delivery', async () => {
    const localVisitorId = randomUUID()
    const localConversationId = randomUUID()
    const localMessageId = randomUUID()
    await db.insert(schema.notificationPreferences).values({
      memberId,
      category: 'unanswered_reminder',
      emailEnabled: false
    })
    await db.insert(schema.visitors).values({
      id: localVisitorId,
      workspaceId,
      visitorId: `visitor_${randomUUID()}`,
      name: 'Quiet Visitor'
    })
    await db.insert(schema.conversations).values({
      id: localConversationId,
      workspaceId,
      visitorRef: localVisitorId
    })
    await db.insert(schema.messages).values({
      id: localMessageId,
      conversationId: localConversationId,
      senderType: 'visitor',
      content: 'Please do not email this teammate.',
      createdAt: new Date('2026-09-01T11:00:00Z')
    })
    const sent: Array<{ to: string }> = []
    await runUnansweredReminderSweep({
      now: new Date('2026-09-01T11:15:00Z'),
      sender: async (message) => {
        sent.push(message)
        return true
      }
    })
    expect(sent).toHaveLength(0)
    const delivery = await db.query.unansweredReminderDeliveries.findFirst({
      where: eq(schema.unansweredReminderDeliveries.visitorMessageId, localMessageId)
    })
    expect(delivery?.status).toBe('canceled')
  })

  it('does not publish a stale reminder after reassignment or a public reply', async () => {
    const secondUserId = randomUUID()
    const secondMemberId = randomUUID()
    const localVisitorId = randomUUID()
    const localConversationId = randomUUID()
    const localMessageId = randomUUID()
    await db.insert(schema.users).values({
      id: secondUserId,
      email: `reminder-secondary-${secondUserId}@example.com`,
      name: 'Secondary Agent'
    })
    await db.insert(schema.workspaceMembers).values({
      id: secondMemberId,
      workspaceId,
      userId: secondUserId,
      role: 'agent'
    })
    await db.insert(schema.visitors).values({
      id: localVisitorId,
      workspaceId,
      visitorId: `visitor_${randomUUID()}`
    })
    await db.insert(schema.conversations).values({
      id: localConversationId,
      workspaceId,
      visitorRef: localVisitorId,
      assignedAgentId: memberId,
      status: 'open'
    })
    await db.insert(schema.messages).values({
      id: localMessageId,
      conversationId: localConversationId,
      senderType: 'visitor',
      content: 'Is anybody there?',
      createdAt: new Date('2026-09-01T12:00:00Z')
    })
    const [delivery] = await db.insert(schema.unansweredReminderDeliveries).values({
      workspaceId,
      conversationId: localConversationId,
      visitorMessageId: localMessageId,
      recipientMemberId: memberId,
      nextAttemptAt: new Date('2026-09-01T12:15:00Z')
    }).returning()

    await db.update(schema.conversations).set({ assignedAgentId: secondMemberId })
      .where(eq(schema.conversations.id, localConversationId))
    expect(await reminderDeliveryIsActionable(delivery!, new Date('2026-09-01T12:15:00Z'))).toBe(false)

    await db.update(schema.conversations).set({ assignedAgentId: memberId })
      .where(eq(schema.conversations.id, localConversationId))
    await db.insert(schema.messages).values({
      conversationId: localConversationId,
      senderType: 'agent',
      senderId: memberId,
      content: 'I can help.',
      createdAt: new Date('2026-09-01T12:01:00Z')
    })
    expect(await reminderDeliveryIsActionable(delivery!, new Date('2026-09-01T12:15:00Z'))).toBe(false)
    await db.delete(schema.users).where(eq(schema.users.id, secondUserId))
  })
})
