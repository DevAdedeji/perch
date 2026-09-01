import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import { and, eq, inArray } from '../packages/db/node_modules/drizzle-orm/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import type { Database } from '../packages/db/src/client'
import * as schema from '../packages/db/src/schema'
import { MAX_BULK_CONVERSATIONS } from '../packages/shared/src/constants'
import {
  bulkConversationActionSchema,
  canBulkAssignConversation,
  mutateConversationsInBulk
} from '../server/utils/bulk-conversations'

const uuid = () => randomUUID()

describe('bulk inbox action boundary', () => {
  const firstId = uuid()
  const secondId = uuid()

  it('deduplicates ids and rejects oversized, empty, malformed, or ambiguous requests', () => {
    const parsed = bulkConversationActionSchema.safeParse({
      action: 'resolve',
      conversation_ids: [firstId, firstId, secondId]
    })
    expect(parsed.success && parsed.data.conversation_ids).toEqual([firstId, secondId])
    expect(bulkConversationActionSchema.safeParse({ action: 'resolve', conversation_ids: [] }).success).toBe(false)
    expect(bulkConversationActionSchema.safeParse({
      action: 'resolve',
      conversation_ids: Array.from({ length: MAX_BULK_CONVERSATIONS + 1 }, uuid)
    }).success).toBe(false)
    expect(bulkConversationActionSchema.safeParse({ action: 'resolve', conversation_ids: ['not-an-id'] }).success).toBe(false)
    expect(bulkConversationActionSchema.safeParse({
      action: 'resolve',
      conversation_ids: [firstId],
      member_id: secondId
    }).success).toBe(false)
  })

  it('allows agents to claim the pool for themselves or transfer only their own work', () => {
    const member = { id: firstId, role: 'agent' as const }
    expect(canBulkAssignConversation(member, { assignedAgentId: null }, firstId)).toBe(true)
    expect(canBulkAssignConversation(member, { assignedAgentId: null }, secondId)).toBe(false)
    expect(canBulkAssignConversation(member, { assignedAgentId: firstId }, secondId)).toBe(true)
    expect(canBulkAssignConversation(member, { assignedAgentId: secondId }, firstId)).toBe(false)
    expect(canBulkAssignConversation({ ...member, role: 'admin' }, { assignedAgentId: secondId }, firstId)).toBe(true)
  })

  it('keeps authorization, abuse controls, audit, and realtime at the route boundary', () => {
    const source = readFileSync(new URL('../server/api/workspaces/[id]/conversations/bulk.post.ts', import.meta.url), 'utf8')
    expect(source).toContain('requireMembership(event, workspaceId)')
    expect(source).toContain('assertRateLimit(\'bulk-conversation-action\'')
    expect(source).toContain('logAudit(workspaceId, user')
    expect(source).toContain('publishConversationUpdate(')
    expect(source).toContain('publishFiltered(channels.workspace(workspaceId)')
  })
})

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('bulk inbox database integration', () => {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema })
  const appDb = db as unknown as Database
  const adminUserId = uuid()
  const agentUserId = uuid()
  const otherUserId = uuid()
  const workspaceId = uuid()
  const otherWorkspaceId = uuid()
  const adminMemberId = uuid()
  const agentMemberId = uuid()
  const otherMemberId = uuid()
  const visitorOneId = uuid()
  const visitorTwoId = uuid()
  const otherVisitorId = uuid()
  const conversationOneId = uuid()
  const conversationTwoId = uuid()
  const otherConversationId = uuid()
  const tagId = uuid()

  beforeAll(async () => {
    await db.insert(schema.users).values([
      { id: adminUserId, email: `bulk-admin-${adminUserId}@example.com`, name: 'Bulk Admin' },
      { id: agentUserId, email: `bulk-agent-${agentUserId}@example.com`, name: 'Bulk Agent' },
      { id: otherUserId, email: `bulk-other-${otherUserId}@example.com`, name: 'Other Agent' }
    ])
    await db.insert(schema.workspaces).values([
      { id: workspaceId, name: 'Bulk Workspace', siteId: `ws_${uuid().replaceAll('-', '').slice(0, 12)}` },
      { id: otherWorkspaceId, name: 'Other Workspace', siteId: `ws_${uuid().replaceAll('-', '').slice(0, 12)}` }
    ])
    await db.insert(schema.workspaceMembers).values([
      { id: adminMemberId, workspaceId, userId: adminUserId, role: 'admin' },
      { id: agentMemberId, workspaceId, userId: agentUserId, role: 'agent' },
      { id: otherMemberId, workspaceId, userId: otherUserId, role: 'agent' }
    ])
    await db.insert(schema.visitors).values([
      { id: visitorOneId, workspaceId, visitorId: `visitor_${uuid()}` },
      { id: visitorTwoId, workspaceId, visitorId: `visitor_${uuid()}` },
      { id: otherVisitorId, workspaceId: otherWorkspaceId, visitorId: `visitor_${uuid()}` }
    ])
    await db.insert(schema.conversations).values([
      { id: conversationOneId, workspaceId, visitorRef: visitorOneId, status: 'unassigned' },
      { id: conversationTwoId, workspaceId, visitorRef: visitorTwoId, status: 'unassigned' },
      { id: otherConversationId, workspaceId: otherWorkspaceId, visitorRef: otherVisitorId, status: 'unassigned' }
    ])
    await db.insert(schema.tags).values({ id: tagId, workspaceId, name: 'priority-customer' })
  })

  afterAll(async () => {
    await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [workspaceId, otherWorkspaceId]))
    await db.delete(schema.users).where(inArray(schema.users.id, [adminUserId, agentUserId, otherUserId]))
    await client.end()
  })

  it('applies tags atomically and reports retries as unchanged', async () => {
    const input = { action: 'add_tag' as const, conversation_ids: [conversationOneId, conversationTwoId], tag_id: tagId }
    const first = await mutateConversationsInBulk(appDb, workspaceId, {
      userId: adminUserId,
      memberId: adminMemberId,
      name: 'Bulk Admin'
    }, input)
    expect(first.changedConversationIds).toHaveLength(2)

    const retry = await mutateConversationsInBulk(appDb, workspaceId, {
      userId: adminUserId,
      memberId: adminMemberId,
      name: 'Bulk Admin'
    }, input)
    expect(retry.changedConversationIds).toHaveLength(0)
  })

  it('rejects one out-of-workspace id without partially changing valid rows', async () => {
    await expect(mutateConversationsInBulk(appDb, workspaceId, {
      userId: adminUserId,
      memberId: adminMemberId,
      name: 'Bulk Admin'
    }, {
      action: 'assign',
      conversation_ids: [conversationOneId, otherConversationId],
      member_id: agentMemberId
    })).rejects.toMatchObject({ statusCode: 404 })

    const valid = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, conversationOneId) })
    expect(valid?.assignedAgentId).toBeNull()
    expect(valid?.status).toBe('unassigned')
  })

  it('rejects an agent assigning pooled work to someone else as one atomic batch', async () => {
    await expect(mutateConversationsInBulk(appDb, workspaceId, {
      userId: agentUserId,
      memberId: agentMemberId,
      name: 'Bulk Agent'
    }, {
      action: 'assign',
      conversation_ids: [conversationOneId, conversationTwoId],
      member_id: otherMemberId
    })).rejects.toMatchObject({ statusCode: 403 })

    const rows = await db.select().from(schema.conversations).where(inArray(schema.conversations.id, [conversationOneId, conversationTwoId]))
    expect(rows.every(row => row.assignedAgentId === null && row.status === 'unassigned')).toBe(true)
  })

  it('records only real resolutions and reopens assigned and pooled work sensibly', async () => {
    await mutateConversationsInBulk(appDb, workspaceId, {
      userId: adminUserId,
      memberId: adminMemberId,
      name: 'Bulk Admin'
    }, {
      action: 'assign',
      conversation_ids: [conversationOneId],
      member_id: agentMemberId
    })
    const resolveInput = { action: 'resolve' as const, conversation_ids: [conversationOneId, conversationTwoId] }
    const resolved = await mutateConversationsInBulk(appDb, workspaceId, {
      userId: adminUserId,
      memberId: adminMemberId,
      name: 'Bulk Admin'
    }, resolveInput)
    expect(resolved.changedConversationIds).toHaveLength(2)

    const retry = await mutateConversationsInBulk(appDb, workspaceId, {
      userId: adminUserId,
      memberId: adminMemberId,
      name: 'Bulk Admin'
    }, resolveInput)
    expect(retry.changedConversationIds).toHaveLength(0)
    const outcomes = await db.select().from(schema.supportOutcomeEvents).where(and(
      eq(schema.supportOutcomeEvents.workspaceId, workspaceId),
      eq(schema.supportOutcomeEvents.eventType, 'resolution')
    ))
    expect(outcomes).toHaveLength(2)

    await mutateConversationsInBulk(appDb, workspaceId, {
      userId: adminUserId,
      memberId: adminMemberId,
      name: 'Bulk Admin'
    }, { action: 'reopen', conversation_ids: [conversationOneId, conversationTwoId] })
    const reopened = await db.select().from(schema.conversations)
      .where(inArray(schema.conversations.id, [conversationOneId, conversationTwoId]))
    expect(reopened.find(row => row.id === conversationOneId)?.status).toBe('open')
    expect(reopened.find(row => row.id === conversationTwoId)?.status).toBe('unassigned')
  })
})
