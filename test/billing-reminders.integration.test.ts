import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import * as schema from '../packages/db/src/schema'
import { eq } from '../packages/db/node_modules/drizzle-orm/index.js'
import { emailLayout, escapeHtml } from '../server/utils/email'
import { isWithinBusinessHours } from '../server/utils/business-hours'
import { markWorkspaceInvoicePaid, workspaceEntitlement } from '../server/utils/billing'
import { runUnansweredReminderSweep } from '../server/utils/unanswered-reminders'

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
      isWithinBusinessHours
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

  it('delivers exactly one email for the same unanswered visitor message', async () => {
    const sent: Array<{ to: string, subject: string }> = []
    const sender = async (message: { to: string, subject: string }) => {
      sent.push(message)
      return true
    }
    await runUnansweredReminderSweep({ now: new Date('2026-09-01T10:15:00Z'), sender })
    await runUnansweredReminderSweep({ now: new Date('2026-09-01T10:16:00Z'), sender })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ subject: 'Waiting Visitor is waiting for a reply' })
    const delivery = await db.query.unansweredReminderDeliveries.findFirst({
      where: eq(schema.unansweredReminderDeliveries.visitorMessageId, messageId)
    })
    expect(delivery?.status).toBe('sent')
  })

  it('activates workspace Pro only after a paid invoice is applied', async () => {
    expect((await workspaceEntitlement(workspaceId)).isPro).toBe(false)
    const reference = `perch-test-${randomUUID()}`
    await db.insert(schema.workspaceInvoices).values({
      workspaceId,
      reference,
      interval: 'monthly',
      amountCents: 900,
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60_000)
    })
    expect((await markWorkspaceInvoicePaid(reference, 'charge_test')).applied).toBe(true)
    expect((await workspaceEntitlement(workspaceId)).isPro).toBe(true)
  })
})
