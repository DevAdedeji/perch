import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import { and, eq, inArray, sql } from '@perch/db'
import * as schema from '../packages/db/src/schema'
import { addAgentMessage, assignConversation, ingestVisitorMessage, startAgentConversation } from '../server/utils/conversations'
import { assertVisitorCanMessage, blockedVisitorIds, isVisitorMessagingBlocked } from '../server/utils/spam-control'
import { createWorkspaceTag, createWorkspaceTrigger } from '../server/utils/workspace-resources'
import { runEntryAutomations } from '../server/utils/automation-engine'
import { getEnabledAutomationRules } from '../server/utils/automation-rules'
import { getEnabledTriggers, matchesTriggerUrl } from '../server/utils/triggers'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('message and workspace mutation reliability', () => {
  const client = postgres(databaseUrl!, { max: 8 })
  const db = drizzle(client, { schema })
  const workspaceIds: string[] = []
  const userIds: string[] = []

  async function fixture() {
    const [workspace] = await db.insert(schema.workspaces).values({ name: 'Reliability test', siteId: `ws_${randomUUID()}` }).returning()
    workspaceIds.push(workspace!.id)
    const users = await db.insert(schema.users).values(['Admin', 'Agent A', 'Agent B'].map(name => ({ name, email: `${randomUUID()}@example.test` }))).returning()
    userIds.push(...users.map(user => user.id))
    const members = await db.insert(schema.workspaceMembers).values(users.map((user, index) => ({ workspaceId: workspace!.id, userId: user.id, role: index === 0 ? 'admin' as const : 'agent' as const }))).returning()
    const [visitor] = await db.insert(schema.visitors).values({ workspaceId: workspace!.id, visitorId: randomUUID() }).returning()
    const [conversation] = await db.insert(schema.conversations).values({ workspaceId: workspace!.id, visitorRef: visitor!.id, assignedAgentId: members[1]!.id, status: 'open' }).returning()
    return { workspace: workspace!, users, members, visitor: visitor!, conversation: conversation! }
  }

  beforeAll(() => {
    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useRuntimeConfig', () => ({ outboundWebhooksEnabled: false }))
    vi.stubGlobal('assertVisitorCanMessage', assertVisitorCanMessage)
    vi.stubGlobal('isVisitorMessagingBlocked', isVisitorMessagingBlocked)
    vi.stubGlobal('sendToVisitor', vi.fn(() => true))
    vi.stubGlobal('runEntryAutomations', runEntryAutomations)
    vi.stubGlobal('getEnabledAutomationRules', getEnabledAutomationRules)
    for (const name of ['publish', 'publishFiltered', 'publishConversationEvent', 'publishMemberNotification']) vi.stubGlobal(name, vi.fn())
  })

  afterEach(async () => {
    if (workspaceIds.length) await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, workspaceIds.splice(0)))
    if (userIds.length) await db.delete(schema.users).where(inArray(schema.users.id, userIds.splice(0)))
  })
  afterAll(async () => {
    vi.unstubAllGlobals()
    await client.end()
  })

  it('reuses one durable agent message and one mention notification after concurrent retries', async () => {
    const f = await fixture()
    const input = { workspaceId: f.workspace.id, conversationId: f.conversation.id, senderMemberId: f.members[1]!.id, content: '@Agent B please check', clientMessageId: randomUUID(), isInternalNote: true, actorName: 'Agent A', mentionRecipientIds: [f.members[2]!.id] }
    const results = await Promise.all(Array.from({ length: 5 }, () => addAgentMessage(input)))
    expect(new Set(results.map(message => message.id)).size).toBe(1)
    expect(await db.query.messages.findMany({ where: eq(schema.messages.conversationId, f.conversation.id) })).toHaveLength(1)
    expect(await db.query.memberNotifications.findMany({ where: eq(schema.memberNotifications.conversationId, f.conversation.id) })).toHaveLength(1)
    await expect(addAgentMessage({ ...input, content: 'Different content' })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('reuses a visitor first-send after response loss without creating a second conversation', async () => {
    const f = await fixture()
    await db.delete(schema.conversations).where(eq(schema.conversations.id, f.conversation.id))
    const input = { workspaceId: f.workspace.id, visitorId: f.visitor.visitorId, content: 'Hello', clientMessageId: randomUUID() }
    const results = await Promise.all(Array.from({ length: 4 }, () => ingestVisitorMessage(input)))
    expect(new Set(results.map(result => result.message.id)).size).toBe(1)
    expect(await db.query.conversations.findMany({ where: eq(schema.conversations.visitorRef, f.visitor.id) })).toHaveLength(1)
    expect(await db.query.messages.findMany({ where: eq(schema.messages.conversationId, results[0]!.conversation.id) })).toHaveLength(1)
    await expect(ingestVisitorMessage({ ...input, content: 'Changed' })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('deduplicates agent outreach and uses the current role rather than a stale admin role', async () => {
    const f = await fixture()
    const input = { workspaceId: f.workspace.id, visitorRef: f.visitor.id, memberId: f.members[1]!.id, memberRole: 'agent' as const, content: 'Can I help?', clientMessageId: randomUUID() }
    const results = await Promise.all(Array.from({ length: 3 }, () => startAgentConversation(input)))
    expect(new Set(results.map(result => result.message.id)).size).toBe(1)
    await expect(startAgentConversation({ ...input, content: 'Changed' })).rejects.toMatchObject({ statusCode: 409 })
    await expect(startAgentConversation({ ...input, clientMessageId: randomUUID(), memberId: f.members[2]!.id, memberRole: 'admin' })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rechecks the current owner after a pending transfer waits for another transaction', async () => {
    const f = await fixture()
    let release!: () => void
    let locked!: () => void
    const ready = new Promise<void>((resolve) => {
      locked = resolve
    })
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const reassignment = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${f.workspace.id}))`)
      await tx.update(schema.conversations).set({ assignedAgentId: f.members[2]!.id }).where(eq(schema.conversations.id, f.conversation.id))
      locked()
      await hold
    })
    await ready
    const pending = assignConversation(f.conversation.id, f.members[0]!.id, { workspaceId: f.workspace.id, memberId: f.members[1]!.id, name: 'Former owner' })
    release()
    await reassignment
    await expect(pending).rejects.toMatchObject({ statusCode: 403 })
    expect((await db.query.conversations.findFirst({ where: eq(schema.conversations.id, f.conversation.id) }))!.assignedAgentId).toBe(f.members[2]!.id)
  })

  it('rejects stale message authors, removed members, and foreign assignment targets', async () => {
    const f = await fixture()
    const input = { workspaceId: f.workspace.id, conversationId: f.conversation.id, senderMemberId: f.members[1]!.id, content: 'Late reply', clientMessageId: randomUUID() }
    await db.update(schema.conversations).set({ assignedAgentId: f.members[2]!.id }).where(eq(schema.conversations.id, f.conversation.id))
    await expect(addAgentMessage(input)).rejects.toMatchObject({ statusCode: 403 })
    await expect(assignConversation(f.conversation.id, randomUUID(), { workspaceId: f.workspace.id, memberId: f.members[0]!.id, name: 'Admin' })).rejects.toMatchObject({ statusCode: 403 })
    await db.delete(schema.workspaceMembers).where(eq(schema.workspaceMembers.id, f.members[1]!.id))
    await expect(addAgentMessage(input)).rejects.toMatchObject({ statusCode: 403 })
    expect(await db.query.messages.findMany({ where: eq(schema.messages.conversationId, f.conversation.id) })).toHaveLength(0)
  })

  it('records reassignment and notification exactly once, including a repeated request', async () => {
    const f = await fixture()
    const actor = { workspaceId: f.workspace.id, memberId: f.members[0]!.id, name: 'Admin' }
    await assignConversation(f.conversation.id, f.members[2]!.id, actor)
    await assignConversation(f.conversation.id, f.members[2]!.id, actor)
    expect(await db.query.auditLogs.findMany({ where: and(eq(schema.auditLogs.workspaceId, f.workspace.id), eq(schema.auditLogs.action, 'conversation.reassigned')) })).toHaveLength(1)
    expect(await db.query.memberNotifications.findMany({ where: eq(schema.memberNotifications.conversationId, f.conversation.id) })).toHaveLength(1)
  })

  it('keeps tag and trigger limits under concurrent creation and returns existing tags at the limit', async () => {
    const f = await fixture()
    await db.insert(schema.tags).values(Array.from({ length: 49 }, (_, index) => ({ workspaceId: f.workspace.id, name: `existing-${index}` })))
    const tagResults = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => createWorkspaceTag(db, f.workspace.id, `new-${index}`)))
    expect(tagResults.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect((await createWorkspaceTag(db, f.workspace.id, 'existing-0')).created).toBe(false)
    await db.insert(schema.triggers).values(Array.from({ length: 19 }, (_, index) => ({ workspaceId: f.workspace.id, name: `existing-${index}`, dwellSeconds: 3, message: 'Hi' })))
    const triggerResults = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => createWorkspaceTrigger(db, { workspaceId: f.workspace.id, name: `new-${index}`, urlMatch: '', dwellSeconds: 3, message: 'Hi' }, f.users[0]!)))
    expect(triggerResults.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await db.query.triggers.findMany({ where: eq(schema.triggers.workspaceId, f.workspace.id) })).toHaveLength(20)
  })

  it('batches moderation and blocks verified sibling sessions without trusting reported identities', async () => {
    const f = await fixture()
    const candidates = await db.insert(schema.visitors).values([
      { workspaceId: f.workspace.id, visitorId: randomUUID(), externalId: 'customer-1', identityVerified: true },
      { workspaceId: f.workspace.id, visitorId: randomUUID(), externalId: 'customer-1', identityVerified: true },
      { workspaceId: f.workspace.id, visitorId: randomUUID(), externalId: 'customer-1', identityVerified: false }
    ]).returning()
    await db.insert(schema.visitorBlocks).values({ workspaceId: f.workspace.id, visitorRef: candidates[0]!.id, blockedByMemberId: f.members[0]!.id })
    const blocked = await blockedVisitorIds(db, f.workspace.id, [candidates[1]!, candidates[2]!, f.visitor])
    expect([...blocked]).toEqual([candidates[1]!.id])
    expect(await blockedVisitorIds(db, f.workspace.id, [])).toEqual(new Set())
  })

  it('deduplicates Nest messages and rejects a member removed after the initial route check', async () => {
    const f = await fixture()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getRouterParam', () => f.workspace.id)
    vi.stubGlobal('requireMembership', () => ({ user: f.users[1], member: f.members[1] }))
    vi.stubGlobal('assertRateLimit', vi.fn())
    vi.stubGlobal('setResponseStatus', vi.fn())
    let body = { content: 'Please check', mentioned_member_ids: [f.members[2]!.id], client_message_id: randomUUID() }
    vi.stubGlobal('readValidatedBody', (_event: unknown, validate: (body: unknown) => unknown) => validate(body))
    const { default: handler } = await import('../server/api/workspaces/[id]/team-chat.post')
    const results = await Promise.all(Array.from({ length: 4 }, () => handler({} as never)))
    expect(new Set(results.map(message => message.id)).size).toBe(1)
    expect(await db.query.teamMessages.findMany({ where: eq(schema.teamMessages.workspaceId, f.workspace.id) })).toHaveLength(1)
    expect(await db.query.memberNotifications.findMany({ where: eq(schema.memberNotifications.workspaceId, f.workspace.id) })).toHaveLength(1)
    body = { ...body, content: 'Different text' }
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 409 })
    await db.delete(schema.workspaceMembers).where(eq(schema.workspaceMembers.id, f.members[1]!.id))
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('does no visitor reads before trigger eligibility and batches all eligible moderation reads', async () => {
    const f = await fixture()
    await db.insert(schema.triggers).values({ workspaceId: f.workspace.id, name: 'Pricing help', urlMatch: '/pricing', dwellSeconds: 3, message: 'Need help?' })
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    let sweep!: () => Promise<void>
    vi.stubGlobal('setInterval', (callback: () => Promise<void>) => {
      sweep = callback
      return { unref() {} }
    })
    vi.stubGlobal('getEnabledTriggers', getEnabledTriggers)
    vi.stubGlobal('matchesTriggerUrl', matchesTriggerUrl)
    vi.stubGlobal('liveWorkspaceIds', () => [f.workspace.id])
    let roster = [{ visitor_ref: f.visitor.id, page_url: 'https://example.test/other', page_since: Date.now() - 10_000 }]
    vi.stubGlobal('liveVisitors', () => roster)
    const send = vi.fn(() => true)
    vi.stubGlobal('sendToVisitor', send)
    const { default: plugin } = await import('../server/plugins/trigger-sweep')
    plugin({} as never)
    const select = vi.spyOn(db, 'select')
    await sweep()
    expect(select).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    roster = roster.map(visitor => ({ ...visitor, page_url: 'https://example.test/pricing' }))
    await sweep()
    expect(select).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledTimes(1)
    select.mockClear()
    await sweep()
    expect(select).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
    const [blocked] = await db.insert(schema.visitors).values({ workspaceId: f.workspace.id, visitorId: randomUUID() }).returning()
    await db.insert(schema.visitorBlocks).values({ workspaceId: f.workspace.id, visitorRef: blocked!.id, blockedByMemberId: f.members[0]!.id })
    roster = [{ visitor_ref: blocked!.id, page_url: 'https://example.test/pricing', page_since: Date.now() - 10_000 }]
    await sweep()
    expect(select).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledTimes(1)
    expect(await db.query.triggerFires.findMany({ where: eq(schema.triggerFires.visitorRef, blocked!.id) })).toHaveLength(0)
    select.mockRestore()
  })
})
