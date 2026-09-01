import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import { eq } from '../packages/db/node_modules/drizzle-orm/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import * as schema from '../packages/db/src/schema'
import { isVisitorMessagingBlocked, linkedVisitorIds } from '../server/utils/spam-control'

describe('spam-control security boundary', () => {
  const markSource = readFileSync(new URL('../server/api/conversations/[id]/spam.post.ts', import.meta.url), 'utf8')
  const restoreSource = readFileSync(new URL('../server/api/conversations/[id]/spam.delete.ts', import.meta.url), 'utf8')
  const messageSource = readFileSync(new URL('../server/api/widget/messages.post.ts', import.meta.url), 'utf8')
  const uploadSource = readFileSync(new URL('../server/api/attachments/upload.post.ts', import.meta.url), 'utf8')
  const websocketSource = readFileSync(new URL('../server/routes/api/ws.ts', import.meta.url), 'utf8')
  const triggerSource = readFileSync(new URL('../server/plugins/trigger-sweep.ts', import.meta.url), 'utf8')

  it('authorizes, rate-limits, workspace-scopes, and audits moderation actions', () => {
    for (const source of [markSource, restoreSource]) {
      expect(source).toContain('requireUser(event)')
      expect(source).toContain(`assertRateLimit('spam-control:member'`)
      expect(source).toContain('eq(workspaceMembers.workspaceId, conversation.workspaceId)')
      expect(source).toContain('canMemberAccessConversation(member, conversation)')
      expect(source).toContain('tx.insert(auditLogs)')
    }
  })

  it('fails closed at every visitor message boundary without revealing moderation internals', () => {
    expect(messageSource).toContain('await assertVisitorCanMessage(visitor)')
    expect(uploadSource).toContain('await assertVisitorCanMessage(visitor)')
    expect(websocketSource).toContain('await isVisitorMessagingBlocked(visitor)')
    expect(triggerSource).toContain('await isVisitorMessagingBlocked(visitorRow)')
    expect(messageSource).not.toContain('spam')
    expect(messageSource).not.toContain('blocked')
  })
})

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('spam-control database integration', () => {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema })
  const workspaceId = randomUUID()
  const otherWorkspaceId = randomUUID()
  const userId = randomUUID()
  const memberId = randomUUID()
  const exactVisitorId = randomUUID()
  const linkedVisitorId = randomUUID()
  const unverifiedVisitorId = randomUUID()
  const otherWorkspaceVisitorId = randomUUID()
  const externalId = `customer-${randomUUID()}`

  beforeAll(async () => {
    Object.assign(globalThis, { useDb: () => db })
    await db.insert(schema.users).values({ id: userId, email: `${userId}@example.com`, name: 'Spam test admin' })
    await db.insert(schema.workspaces).values([
      { id: workspaceId, name: 'Spam test', siteId: `ws_${randomUUID().replaceAll('-', '').slice(0, 10)}` },
      { id: otherWorkspaceId, name: 'Other workspace', siteId: `ws_${randomUUID().replaceAll('-', '').slice(0, 10)}` }
    ])
    await db.insert(schema.workspaceMembers).values({ id: memberId, workspaceId, userId, role: 'admin' })
    await db.insert(schema.visitors).values([
      { id: exactVisitorId, workspaceId, visitorId: `visitor_${randomUUID()}`, externalId, identityVerified: true },
      { id: linkedVisitorId, workspaceId, visitorId: `visitor_${randomUUID()}`, externalId, identityVerified: true },
      { id: unverifiedVisitorId, workspaceId, visitorId: `visitor_${randomUUID()}`, externalId, identityVerified: false },
      { id: otherWorkspaceVisitorId, workspaceId: otherWorkspaceId, visitorId: `visitor_${randomUUID()}`, externalId, identityVerified: true }
    ])
    await db.insert(schema.visitorBlocks).values({
      workspaceId,
      visitorRef: exactVisitorId,
      blockedByMemberId: memberId
    })
  })

  afterAll(async () => {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, otherWorkspaceId))
    await db.delete(schema.users).where(eq(schema.users.id, userId))
    await client.end()
  })

  it('links only verified identities inside the same workspace', async () => {
    const exact = await db.query.visitors.findFirst({ where: eq(schema.visitors.id, exactVisitorId) })
    const linked = await db.query.visitors.findFirst({ where: eq(schema.visitors.id, linkedVisitorId) })
    const unverified = await db.query.visitors.findFirst({ where: eq(schema.visitors.id, unverifiedVisitorId) })
    const otherWorkspace = await db.query.visitors.findFirst({ where: eq(schema.visitors.id, otherWorkspaceVisitorId) })

    expect(await linkedVisitorIds(db, exact!)).toEqual(expect.arrayContaining([exactVisitorId, linkedVisitorId]))
    expect(await isVisitorMessagingBlocked(exact!, db)).toBe(true)
    expect(await isVisitorMessagingBlocked(linked!, db)).toBe(true)
    expect(await isVisitorMessagingBlocked(unverified!, db)).toBe(false)
    expect(await isVisitorMessagingBlocked(otherWorkspace!, db)).toBe(false)
  })

  it('allows one active block per visitor while preserving unblock and reblock history', async () => {
    await expect(db.insert(schema.visitorBlocks).values({
      workspaceId,
      visitorRef: exactVisitorId,
      blockedByMemberId: memberId
    })).rejects.toBeTruthy()

    await db.update(schema.visitorBlocks).set({
      unblockedAt: new Date(),
      unblockedByMemberId: memberId
    }).where(eq(schema.visitorBlocks.visitorRef, exactVisitorId))
    await db.insert(schema.visitorBlocks).values({
      workspaceId,
      visitorRef: exactVisitorId,
      blockedByMemberId: memberId
    })

    const history = await db.query.visitorBlocks.findMany({
      where: eq(schema.visitorBlocks.visitorRef, exactVisitorId)
    })
    expect(history).toHaveLength(2)
    expect(history.filter(block => block.unblockedAt === null)).toHaveLength(1)
  })

  it('rejects inconsistent spam state at the database boundary', async () => {
    await expect(db.insert(schema.conversations).values({
      workspaceId,
      visitorRef: unverifiedVisitorId,
      isSpam: true
    })).rejects.toBeTruthy()

    const [conversation] = await db.insert(schema.conversations).values({
      workspaceId,
      visitorRef: unverifiedVisitorId,
      status: 'resolved',
      isSpam: true,
      spamMarkedAt: new Date(),
      spamMarkedByMemberId: memberId
    }).returning()
    expect(conversation?.isSpam).toBe(true)
  })
})
