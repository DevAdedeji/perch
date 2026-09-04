import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import { and, eq } from '../packages/db/node_modules/drizzle-orm/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import * as schema from '../packages/db/src/schema'
import {
  breachedResponseSlaCondition,
  calculateResponseSla,
  responseSlaMessageTimes
} from '../server/utils/response-sla'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('response SLA database integration', () => {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema })
  const userId = randomUUID()
  const workspaceId = randomUUID()
  const memberId = randomUUID()
  const visitorId = randomUUID()
  const conversationId = randomUUID()

  beforeAll(async () => {
    await db.insert(schema.users).values({ id: userId, email: `sla-${userId}@example.com`, name: 'SLA Agent' })
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'SLA Workspace',
      siteId: `ws_${randomUUID().replaceAll('-', '').slice(0, 10)}`,
      unansweredReminderDelayMinutes: 15
    })
    await db.insert(schema.workspaceMembers).values({ id: memberId, workspaceId, userId, role: 'admin' })
    await db.insert(schema.visitors).values({ id: visitorId, workspaceId, visitorId: `visitor_${randomUUID()}` })
    await db.insert(schema.conversations).values({ id: conversationId, workspaceId, visitorRef: visitorId, assignedAgentId: memberId })
    await db.insert(schema.messages).values([
      {
        conversationId,
        senderType: 'visitor',
        content: 'I need help',
        createdAt: new Date('2026-09-01T09:00:00.000Z')
      },
      {
        conversationId,
        senderType: 'agent',
        senderId: memberId,
        content: 'Private note',
        isInternalNote: true,
        createdAt: new Date('2026-09-01T09:01:00.000Z')
      }
    ])
  })

  afterAll(async () => {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
    await db.delete(schema.users).where(eq(schema.users.id, userId))
    await client.end()
  })

  it('finds breached conversations while excluding internal notes from replies', async () => {
    const rows = await db.select({ id: schema.conversations.id }).from(schema.conversations).where(and(
      eq(schema.conversations.id, conversationId),
      breachedResponseSlaCondition(15)
    ))
    expect(rows).toHaveLength(1)
    const times = await responseSlaMessageTimes(db, [conversationId])
    expect(times.get(conversationId)).toEqual({
      latestVisitorAt: new Date('2026-09-01T09:00:00.000Z'),
      latestAgentAt: null
    })
    expect(calculateResponseSla({
      conversationStatus: 'open',
      latestVisitorAt: times.get(conversationId)!.latestVisitorAt,
      latestAgentAt: times.get(conversationId)!.latestAgentAt,
      targetMinutes: 15,
      now: new Date('2026-09-01T10:00:00.000Z')
    }).status).toBe('breached')
  })

  it('stops breaching after a public reply without changing assignment', async () => {
    await db.insert(schema.messages).values({
      conversationId,
      senderType: 'agent',
      senderId: memberId,
      content: 'How can I help?',
      createdAt: new Date('2026-09-01T09:30:00.000Z')
    })
    const rows = await db.select({ id: schema.conversations.id }).from(schema.conversations).where(and(
      eq(schema.conversations.id, conversationId),
      breachedResponseSlaCondition(15)
    ))
    expect(rows).toHaveLength(0)
    const conversation = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, conversationId) })
    expect(conversation?.assignedAgentId).toBe(memberId)
  })
})
