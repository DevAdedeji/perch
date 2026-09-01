import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import { eq } from '../packages/db/node_modules/drizzle-orm/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import * as schema from '../packages/db/src/schema'
import { customerProfileUpdateSchema, getCustomerContext } from '../server/utils/customer-profiles'

describe('customer profile input', () => {
  const updateRouteSource = readFileSync(
    new URL('../server/api/conversations/[id]/customer.patch.ts', import.meta.url),
    'utf8'
  )

  it('normalizes optional internal details without retaining empty values', () => {
    const result = customerProfileUpdateSchema.parse({
      name: '  Ada Lovelace  ',
      email: ' ADA@EXAMPLE.COM ',
      company: '  ',
      job_title: null,
      internal_note: ' Prefers email ',
      tag_ids: [],
      expected_version: 2
    })
    expect(result).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      company: null,
      job_title: null,
      internal_note: 'Prefers email',
      expected_version: 2
    })
  })

  it('rejects duplicate tags, oversized notes, unexpected fields, and empty updates', () => {
    const tagId = randomUUID()
    expect(customerProfileUpdateSchema.safeParse({ tag_ids: [tagId, tagId], expected_version: 1 }).success).toBe(false)
    expect(customerProfileUpdateSchema.safeParse({ internal_note: 'x'.repeat(2001), expected_version: 1 }).success).toBe(false)
    expect(customerProfileUpdateSchema.safeParse({ company: 'Perch', secret: 'nope', expected_version: 1 }).success).toBe(false)
    expect(customerProfileUpdateSchema.safeParse({ expected_version: 1 }).success).toBe(false)
  })

  it('keeps updates behind conversation access and per-member rate limits', () => {
    expect(updateRouteSource).toContain('requireConversationMember(event, conversationId)')
    expect(updateRouteSource).toContain(`assertRateLimit('customer-profile:member', member.id`)
  })
})

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('customer context database integration', () => {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema })
  const adminUserId = randomUUID()
  const agentUserId = randomUUID()
  const otherUserId = randomUUID()
  const workspaceId = randomUUID()
  const agentMemberId = randomUUID()
  const otherMemberId = randomUUID()
  const visitorId = randomUUID()
  const currentConversationId = randomUUID()

  beforeAll(async () => {
    Object.assign(globalThis, { useDb: () => db })
    await db.insert(schema.users).values([
      { id: adminUserId, email: `${adminUserId}@example.com`, name: 'Admin' },
      { id: agentUserId, email: `${agentUserId}@example.com`, name: 'Agent' },
      { id: otherUserId, email: `${otherUserId}@example.com`, name: 'Other agent' }
    ])
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Customer Context',
      siteId: `ws_${randomUUID().replaceAll('-', '').slice(0, 10)}`
    })
    const [adminMember] = await db.insert(schema.workspaceMembers).values({
      workspaceId,
      userId: adminUserId,
      role: 'admin'
    }).returning()
    await db.insert(schema.workspaceMembers).values([
      { id: agentMemberId, workspaceId, userId: agentUserId, role: 'agent' },
      { id: otherMemberId, workspaceId, userId: otherUserId, role: 'agent' }
    ])
    await db.insert(schema.visitors).values({
      id: visitorId,
      workspaceId,
      visitorId: `visitor_${randomUUID()}`,
      name: 'Reported name',
      profileName: 'Support name',
      company: 'Analytical Engines Ltd'
    })
    const [tag] = await db.insert(schema.tags).values({ workspaceId, name: 'vip' }).returning()
    await db.insert(schema.visitorTags).values({ visitorId, tagId: tag!.id })
    await db.insert(schema.conversations).values([
      { id: currentConversationId, workspaceId, visitorRef: visitorId, assignedAgentId: agentMemberId, status: 'open' },
      { workspaceId, visitorRef: visitorId, assignedAgentId: agentMemberId, status: 'resolved' },
      { workspaceId, visitorRef: visitorId, assignedAgentId: otherMemberId, collaboratorMemberIds: [agentMemberId], status: 'resolved' },
      { workspaceId, visitorRef: visitorId, assignedAgentId: null, status: 'resolved' },
      { workspaceId, visitorRef: visitorId, assignedAgentId: otherMemberId, status: 'resolved' }
    ])
    expect(adminMember).toBeTruthy()
  })

  afterAll(async () => {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
    await db.delete(schema.users).where(eq(schema.users.id, adminUserId))
    await db.delete(schema.users).where(eq(schema.users.id, agentUserId))
    await db.delete(schema.users).where(eq(schema.users.id, otherUserId))
    await client.end()
  })

  it('returns profile tags and only conversation history the agent may access', async () => {
    const conversation = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, currentConversationId)
    })
    const member = await db.query.workspaceMembers.findFirst({
      where: eq(schema.workspaceMembers.id, agentMemberId)
    })
    const context = await getCustomerContext(conversation!, member!)
    expect(context.visitor).toMatchObject({
      name: 'Support name',
      reported_name: 'Reported name',
      company: 'Analytical Engines Ltd',
      tags: [{ name: 'vip' }]
    })
    expect(context.past_conversations).toBe(3)
    expect(context.recent_conversations).toHaveLength(3)
  })
})
