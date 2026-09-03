import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import { and, eq } from '../packages/db/node_modules/drizzle-orm/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import * as schema from '../packages/db/src/schema'
import { applyResendVisitorSuppression } from '../server/utils/resend-webhooks'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('Resend suppression database integration', () => {
  const client = postgres(databaseUrl!, { max: 2 })
  const db = drizzle(client, { schema })
  const workspaceId = randomUUID()
  const otherWorkspaceId = randomUUID()
  const visitorId = randomUUID()
  const otherVisitorId = randomUUID()
  const conversationId = randomUUID()
  const otherConversationId = randomUUID()
  const emailHash = 'stable-private-email-hash'

  beforeAll(async () => {
    Object.assign(globalThis, { useDb: () => db })
    await db.insert(schema.workspaces).values([
      { id: workspaceId, name: 'Resend Test', siteId: `ws_${randomUUID().replaceAll('-', '').slice(0, 12)}` },
      { id: otherWorkspaceId, name: 'Other Workspace', siteId: `ws_${randomUUID().replaceAll('-', '').slice(0, 12)}` }
    ])
    await db.insert(schema.visitors).values([
      { id: visitorId, workspaceId, visitorId: `visitor_${randomUUID()}` },
      { id: otherVisitorId, workspaceId: otherWorkspaceId, visitorId: `visitor_${randomUUID()}` }
    ])
    await db.insert(schema.conversations).values([
      { id: conversationId, workspaceId, visitorRef: visitorId },
      { id: otherConversationId, workspaceId: otherWorkspaceId, visitorRef: otherVisitorId }
    ])
  })

  afterAll(async () => {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, otherWorkspaceId))
    await client.end()
  })

  async function addDelivery(input: {
    workspace: string
    visitor: string
    conversation: string
    status: 'pending' | 'failed' | 'processing' | 'sent'
    providerMessageId?: string
  }) {
    const visitorMessageId = randomUUID()
    const agentMessageId = randomUUID()
    await db.insert(schema.messages).values([
      { id: visitorMessageId, conversationId: input.conversation, senderType: 'visitor', content: 'question' },
      { id: agentMessageId, conversationId: input.conversation, senderType: 'agent', content: 'answer' }
    ])
    const [delivery] = await db.insert(schema.visitorReplyDeliveries).values({
      workspaceId: input.workspace,
      conversationId: input.conversation,
      visitorRef: input.visitor,
      visitorMessageId,
      agentMessageId,
      recipientEmailHash: emailHash,
      status: input.status,
      attempts: input.status === 'pending' ? 0 : 1,
      nextAttemptAt: new Date('2026-09-03T00:00:00Z'),
      tokenExpiresAt: new Date('2026-09-10T00:00:00Z'),
      lockedAt: input.status === 'processing' ? new Date('2026-09-03T00:00:00Z') : null,
      sentAt: input.status === 'sent' ? new Date('2026-09-03T00:00:00Z') : null,
      providerMessageId: input.providerMessageId ?? null
    }).returning()
    return delivery!
  }

  it('durably suppresses only the matched workspace and cancels every queued state', async () => {
    const sent = await addDelivery({
      workspace: workspaceId, visitor: visitorId, conversation: conversationId,
      status: 'sent', providerMessageId: 'resend-provider-message-1'
    })
    const pending = await addDelivery({ workspace: workspaceId, visitor: visitorId, conversation: conversationId, status: 'pending' })
    const failed = await addDelivery({ workspace: workspaceId, visitor: visitorId, conversation: conversationId, status: 'failed' })
    const processing = await addDelivery({ workspace: workspaceId, visitor: visitorId, conversation: conversationId, status: 'processing' })
    const other = await addDelivery({
      workspace: otherWorkspaceId, visitor: otherVisitorId, conversation: otherConversationId, status: 'pending'
    })
    await db.insert(schema.visitorEmailSuppressions).values({
      workspaceId, emailHash, reason: 'unsubscribe'
    })

    expect(await applyResendVisitorSuppression('resend-provider-message-1', 'bounce')).toEqual({ matched: 1, canceled: 3 })
    const suppression = await db.query.visitorEmailSuppressions.findFirst({
      where: and(
        eq(schema.visitorEmailSuppressions.workspaceId, workspaceId),
        eq(schema.visitorEmailSuppressions.emailHash, emailHash)
      )
    })
    expect(suppression?.reason).toBe('bounce')

    for (const id of [pending.id, failed.id, processing.id]) {
      expect(await db.query.visitorReplyDeliveries.findFirst({ where: eq(schema.visitorReplyDeliveries.id, id) }))
        .toMatchObject({ status: 'canceled', cancelReason: 'suppressed_bounce', lockedAt: null })
    }
    expect(await db.query.visitorReplyDeliveries.findFirst({ where: eq(schema.visitorReplyDeliveries.id, sent.id) }))
      .toMatchObject({ status: 'sent' })
    expect(await db.query.visitorReplyDeliveries.findFirst({ where: eq(schema.visitorReplyDeliveries.id, other.id) }))
      .toMatchObject({ status: 'pending' })
  })

  it('is idempotent, upgrades bounce to complaint, and ignores unknown provider IDs', async () => {
    expect(await applyResendVisitorSuppression('resend-provider-message-1', 'bounce')).toEqual({ matched: 1, canceled: 0 })
    expect(await applyResendVisitorSuppression('resend-provider-message-1', 'complaint')).toEqual({ matched: 1, canceled: 0 })
    expect(await applyResendVisitorSuppression('unknown-provider-message', 'bounce')).toEqual({ matched: 0, canceled: 0 })

    const suppression = await db.query.visitorEmailSuppressions.findFirst({
      where: and(
        eq(schema.visitorEmailSuppressions.workspaceId, workspaceId),
        eq(schema.visitorEmailSuppressions.emailHash, emailHash)
      )
    })
    expect(suppression?.reason).toBe('complaint')
  })
})
