import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import { eq } from '../packages/db/node_modules/drizzle-orm/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import * as schema from '../packages/db/src/schema'
import { runVisitorReplyEmailSweep, visitorEmailHash } from '../server/utils/visitor-email-continuity'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('visitor email continuity database integration', () => {
  const client = postgres(databaseUrl!, { max: 2 })
  const db = drizzle(client, { schema })
  const workspaceId = randomUUID()
  const visitorId = randomUUID()
  const conversationId = randomUUID()
  const recipient = `visitor-${visitorId}@example.com`

  beforeAll(async () => {
    Object.assign(globalThis, {
      useDb: () => db,
      useRuntimeConfig: () => ({
        publicBaseUrl: 'https://useperch.xyz',
        visitorReplySecret: 'integration-visitor-reply-secret-849201'
      })
    })
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Northstar Support',
      siteId: `ws_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      visitorReplyEmailEnabled: true
    })
    await db.insert(schema.visitors).values({
      id: visitorId,
      workspaceId,
      visitorId: `visitor_${randomUUID()}`,
      email: recipient,
      emailSource: 'prechat',
      emailUpdatedAt: new Date('2026-09-02T09:00:00Z'),
      replyEmailEnabled: true,
      replyEmailConsentAt: new Date('2026-09-02T09:00:00Z')
    })
    await db.insert(schema.conversations).values({ id: conversationId, workspaceId, visitorRef: visitorId })
  })

  afterAll(async () => {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
    await client.end()
  })

  async function createTurn(at: string) {
    const visitorMessageId = randomUUID()
    const agentMessageId = randomUUID()
    const created = new Date(at)
    await db.insert(schema.messages).values([
      { id: visitorMessageId, conversationId, senderType: 'visitor', content: 'private visitor question', createdAt: created },
      { id: agentMessageId, conversationId, senderType: 'agent', content: 'private agent answer', createdAt: new Date(created.getTime() + 1000) }
    ])
    return { visitorMessageId, agentMessageId }
  }

  it('delivers once per visitor turn with a generic, idempotent payload', async () => {
    const turn = await createTurn('2026-09-02T10:00:00Z')
    const deliveryId = randomUUID()
    await db.insert(schema.visitorReplyDeliveries).values({
      id: deliveryId,
      workspaceId,
      conversationId,
      visitorRef: visitorId,
      visitorMessageId: turn.visitorMessageId,
      agentMessageId: turn.agentMessageId,
      recipientEmailHash: visitorEmailHash(recipient),
      nextAttemptAt: new Date('2026-09-02T10:01:30Z'),
      tokenExpiresAt: new Date('2026-09-09T10:00:00Z')
    })
    await db.insert(schema.visitorReplyDeliveries).values({
      workspaceId,
      conversationId,
      visitorRef: visitorId,
      visitorMessageId: turn.visitorMessageId,
      agentMessageId: turn.agentMessageId,
      recipientEmailHash: visitorEmailHash(recipient),
      nextAttemptAt: new Date('2026-09-02T10:01:30Z'),
      tokenExpiresAt: new Date('2026-09-09T10:00:00Z')
    }).onConflictDoNothing()

    const sent: Array<{ to: string, subject: string, html: string, idempotencyKey?: string }> = []
    const sender = async (message: typeof sent[number]) => {
      sent.push(message)
      return { accepted: true, providerMessageId: 'resend_1', retryable: false, error: null }
    }
    await runVisitorReplyEmailSweep({ now: new Date('2026-09-02T10:02:00Z'), sender })
    await runVisitorReplyEmailSweep({ now: new Date('2026-09-02T10:03:00Z'), sender })

    const delivery = await db.query.visitorReplyDeliveries.findFirst({ where: eq(schema.visitorReplyDeliveries.id, deliveryId) })
    expect(sent, JSON.stringify(delivery)).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      to: recipient,
      subject: 'Northstar Support replied to your message',
      idempotencyKey: `perch-visitor-reply:${deliveryId}`
    })
    expect(sent[0]!.html).not.toContain('private visitor question')
    expect(sent[0]!.html).not.toContain('private agent answer')
    expect(delivery).toMatchObject({ status: 'sent', providerMessageId: 'resend_1' })
  })

  it('cancels delivery when the visitor already read the agent response', async () => {
    const turn = await createTurn('2026-09-02T11:00:00Z')
    const deliveryId = randomUUID()
    await db.insert(schema.visitorConversationReads).values({
      conversationId,
      visitorRef: visitorId,
      lastMessageId: turn.agentMessageId,
      readAt: new Date('2026-09-02T11:00:30Z')
    }).onConflictDoUpdate({
      target: schema.visitorConversationReads.conversationId,
      set: { lastMessageId: turn.agentMessageId, readAt: new Date('2026-09-02T11:00:30Z') }
    })
    await db.insert(schema.visitorReplyDeliveries).values({
      id: deliveryId,
      workspaceId,
      conversationId,
      visitorRef: visitorId,
      visitorMessageId: turn.visitorMessageId,
      agentMessageId: turn.agentMessageId,
      recipientEmailHash: visitorEmailHash(recipient),
      nextAttemptAt: new Date('2026-09-02T11:01:30Z'),
      tokenExpiresAt: new Date('2026-09-09T11:00:00Z')
    })
    let sent = 0
    await runVisitorReplyEmailSweep({
      now: new Date('2026-09-02T11:02:00Z'),
      sender: async () => {
        sent++
        return { accepted: true, providerMessageId: 'unexpected', retryable: false, error: null }
      }
    })
    expect(sent).toBe(0)
    const delivery = await db.query.visitorReplyDeliveries.findFirst({ where: eq(schema.visitorReplyDeliveries.id, deliveryId) })
    expect(delivery).toMatchObject({ status: 'canceled', cancelReason: 'already_read' })
  })

  it('retries a temporary provider failure and keeps one idempotency key', async () => {
    const turn = await createTurn('2026-09-02T12:00:00Z')
    const deliveryId = randomUUID()
    await db.insert(schema.visitorReplyDeliveries).values({
      id: deliveryId,
      workspaceId,
      conversationId,
      visitorRef: visitorId,
      visitorMessageId: turn.visitorMessageId,
      agentMessageId: turn.agentMessageId,
      recipientEmailHash: visitorEmailHash(recipient),
      nextAttemptAt: new Date('2026-09-02T12:01:30Z'),
      tokenExpiresAt: new Date('2026-09-09T12:00:00Z')
    })
    const keys: Array<string | undefined> = []
    let attempt = 0
    const sender = async (message: { idempotencyKey?: string }) => {
      keys.push(message.idempotencyKey)
      attempt++
      return attempt === 1
        ? { accepted: false, providerMessageId: null, retryable: true, error: 'temporary outage' }
        : { accepted: true, providerMessageId: 'resend_2', retryable: false, error: null }
    }
    await runVisitorReplyEmailSweep({ now: new Date('2026-09-02T12:02:00Z'), sender })
    const failed = await db.query.visitorReplyDeliveries.findFirst({ where: eq(schema.visitorReplyDeliveries.id, deliveryId) })
    expect(failed).toMatchObject({ status: 'failed', attempts: 1, lastError: 'temporary outage' })
    expect(failed?.nextAttemptAt.toISOString()).toBe('2026-09-02T12:03:00.000Z')

    await runVisitorReplyEmailSweep({ now: new Date('2026-09-02T12:03:01Z'), sender })
    const sent = await db.query.visitorReplyDeliveries.findFirst({ where: eq(schema.visitorReplyDeliveries.id, deliveryId) })
    expect(sent).toMatchObject({ status: 'sent', attempts: 2, providerMessageId: 'resend_2' })
    expect(keys).toEqual([
      `perch-visitor-reply:${deliveryId}`,
      `perch-visitor-reply:${deliveryId}`
    ])
  })

  it('recovers a stale final-attempt claim without exceeding the retry bound', async () => {
    const turn = await createTurn('2026-09-02T13:00:00Z')
    const deliveryId = randomUUID()
    await db.insert(schema.visitorReplyDeliveries).values({
      id: deliveryId,
      workspaceId,
      conversationId,
      visitorRef: visitorId,
      visitorMessageId: turn.visitorMessageId,
      agentMessageId: turn.agentMessageId,
      recipientEmailHash: visitorEmailHash(recipient),
      status: 'processing',
      attempts: 5,
      lockedAt: new Date('2026-09-02T12:40:00Z'),
      nextAttemptAt: new Date('2026-09-02T13:00:00Z'),
      tokenExpiresAt: new Date('2026-09-09T13:00:00Z')
    })
    await runVisitorReplyEmailSweep({
      now: new Date('2026-09-02T13:02:00Z'),
      sender: async () => ({ accepted: true, providerMessageId: 'resend_recovered', retryable: false, error: null })
    })
    const delivery = await db.query.visitorReplyDeliveries.findFirst({ where: eq(schema.visitorReplyDeliveries.id, deliveryId) })
    expect(delivery).toMatchObject({ status: 'sent', attempts: 5, providerMessageId: 'resend_recovered' })
  })

  it('honors a durable unsubscribe suppression before contacting the sender', async () => {
    const turn = await createTurn('2026-09-02T14:00:00Z')
    const deliveryId = randomUUID()
    await db.insert(schema.visitorEmailSuppressions).values({
      workspaceId,
      emailHash: visitorEmailHash(recipient),
      reason: 'unsubscribe'
    })
    await db.insert(schema.visitorReplyDeliveries).values({
      id: deliveryId,
      workspaceId,
      conversationId,
      visitorRef: visitorId,
      visitorMessageId: turn.visitorMessageId,
      agentMessageId: turn.agentMessageId,
      recipientEmailHash: visitorEmailHash(recipient),
      nextAttemptAt: new Date('2026-09-02T14:01:30Z'),
      tokenExpiresAt: new Date('2026-09-09T14:00:00Z')
    })
    let contacted = false
    await runVisitorReplyEmailSweep({
      now: new Date('2026-09-02T14:02:00Z'),
      sender: async () => {
        contacted = true
        return { accepted: true, providerMessageId: 'unexpected', retryable: false, error: null }
      }
    })
    expect(contacted).toBe(false)
    const delivery = await db.query.visitorReplyDeliveries.findFirst({ where: eq(schema.visitorReplyDeliveries.id, deliveryId) })
    expect(delivery).toMatchObject({ status: 'canceled', cancelReason: 'suppressed_unsubscribe' })
  })
})
