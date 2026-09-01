import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import { and, eq, inArray, isNull, ne } from '../packages/db/node_modules/drizzle-orm/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import * as schema from '../packages/db/src/schema'
import { addAgentMessage } from '../server/utils/conversations'
import {
  isVisitorMessagingBlocked,
  linkedVisitorIds,
  lockVisitorModerationIdentity
} from '../server/utils/spam-control'

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
      expect(source).toContain('await lockVisitorModerationIdentity(tx, visitor)')
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
  const client = postgres(databaseUrl!, { max: 4 })
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

  it('rejects a public agent reply using the freshly locked spam state', async () => {
    const visitorId = randomUUID()
    const conversationId = randomUUID()
    await db.insert(schema.visitors).values({
      id: visitorId,
      workspaceId,
      visitorId: `visitor_${randomUUID()}`
    })
    await db.insert(schema.conversations).values({
      id: conversationId,
      workspaceId,
      visitorRef: visitorId
    })

    const staleConversation = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId)
    })
    expect(staleConversation?.isSpam).toBe(false)

    let spamWriteReady!: () => void
    const spamWritten = new Promise<void>((resolve) => {
      spamWriteReady = resolve
    })
    let releaseSpamWrite!: () => void
    const holdSpamWrite = new Promise<void>((resolve) => {
      releaseSpamWrite = resolve
    })
    const spamWrite = db.transaction(async (tx) => {
      await tx.select().from(schema.conversations)
        .where(eq(schema.conversations.id, conversationId)).for('update')
      await tx.update(schema.conversations).set({
        status: 'resolved',
        resolvedAt: new Date(),
        isSpam: true,
        spamMarkedAt: new Date(),
        spamMarkedByMemberId: memberId
      }).where(eq(schema.conversations.id, conversationId))
      spamWriteReady()
      await holdSpamWrite
    })

    await spamWritten
    let replySettled = false
    const reply = addAgentMessage({
      conversationId,
      workspaceId,
      senderMemberId: memberId,
      content: 'This reply must not be delivered.',
      isInternalNote: false
    }).finally(() => { replySettled = true })
    const replyRejected = expect(reply).rejects.toMatchObject({ statusCode: 409 })
    await new Promise(resolve => setTimeout(resolve, 75))
    expect(replySettled).toBe(false)
    releaseSpamWrite()
    await spamWrite
    await replyRejected

    const inserted = await db.query.messages.findMany({
      where: eq(schema.messages.conversationId, conversationId)
    })
    expect(inserted).toHaveLength(0)
  })

  it('serializes linked-identity mark and restore so the final spam identity stays blocked', async () => {
    const raceExternalId = `race-${randomUUID()}`
    const markVisitorId = randomUUID()
    const restoreVisitorId = randomUUID()
    const markConversationId = randomUUID()
    const restoreConversationId = randomUUID()
    const now = new Date()

    await db.insert(schema.visitors).values([
      {
        id: markVisitorId,
        workspaceId,
        visitorId: `visitor_${randomUUID()}`,
        externalId: raceExternalId,
        identityVerified: true
      },
      {
        id: restoreVisitorId,
        workspaceId,
        visitorId: `visitor_${randomUUID()}`,
        externalId: raceExternalId,
        identityVerified: true
      }
    ])
    await db.insert(schema.conversations).values([
      { id: markConversationId, workspaceId, visitorRef: markVisitorId },
      {
        id: restoreConversationId,
        workspaceId,
        visitorRef: restoreVisitorId,
        status: 'resolved',
        resolvedAt: now,
        isSpam: true,
        spamMarkedAt: now,
        spamMarkedByMemberId: memberId
      }
    ])
    await db.insert(schema.visitorBlocks).values({
      workspaceId,
      visitorRef: restoreVisitorId,
      sourceConversationId: restoreConversationId,
      blockedByMemberId: memberId
    })

    let markCheckedActiveBlock!: () => void
    const markChecked = new Promise<void>((resolve) => {
      markCheckedActiveBlock = resolve
    })
    let releaseMark!: () => void
    const holdMark = new Promise<void>((resolve) => {
      releaseMark = resolve
    })

    const mark = db.transaction(async (tx) => {
      const [conversation] = await tx.select().from(schema.conversations)
        .where(eq(schema.conversations.id, markConversationId)).for('update')
      const [visitor] = await tx.select().from(schema.visitors)
        .where(eq(schema.visitors.id, markVisitorId)).for('update')
      await lockVisitorModerationIdentity(tx, visitor!)
      const visitorIds = await linkedVisitorIds(tx, visitor!)
      const activeBlock = await tx.query.visitorBlocks.findFirst({
        where: and(
          eq(schema.visitorBlocks.workspaceId, workspaceId),
          inArray(schema.visitorBlocks.visitorRef, visitorIds),
          isNull(schema.visitorBlocks.unblockedAt)
        )
      })
      expect(activeBlock).toBeTruthy()
      markCheckedActiveBlock()
      await holdMark

      await tx.update(schema.conversations).set({
        status: 'resolved',
        resolvedAt: now,
        isSpam: true,
        spamMarkedAt: now,
        spamMarkedByMemberId: memberId
      }).where(eq(schema.conversations.id, conversation!.id))
      if (!activeBlock) {
        await tx.insert(schema.visitorBlocks).values({
          workspaceId,
          visitorRef: visitor!.id,
          sourceConversationId: conversation!.id,
          blockedByMemberId: memberId
        })
      }
    })

    await markChecked
    let restoreReachedLock!: () => void
    const restoreAttempted = new Promise<void>((resolve) => {
      restoreReachedLock = resolve
    })
    let restoreAcquiredIdentityLock = false
    const restore = db.transaction(async (tx) => {
      const [conversation] = await tx.select().from(schema.conversations)
        .where(eq(schema.conversations.id, restoreConversationId)).for('update')
      const [visitor] = await tx.select().from(schema.visitors)
        .where(eq(schema.visitors.id, restoreVisitorId)).for('update')
      restoreReachedLock()
      await lockVisitorModerationIdentity(tx, visitor!)
      restoreAcquiredIdentityLock = true

      await tx.update(schema.conversations).set({
        isSpam: false,
        spamMarkedAt: null,
        spamMarkedByMemberId: null
      }).where(eq(schema.conversations.id, conversation!.id))
      const visitorIds = await linkedVisitorIds(tx, visitor!)
      const otherSpam = await tx.query.conversations.findFirst({
        where: and(
          eq(schema.conversations.workspaceId, workspaceId),
          inArray(schema.conversations.visitorRef, visitorIds),
          eq(schema.conversations.isSpam, true),
          ne(schema.conversations.id, conversation!.id)
        )
      })
      if (!otherSpam) {
        await tx.update(schema.visitorBlocks).set({
          unblockedAt: new Date(),
          unblockedByMemberId: memberId
        }).where(and(
          eq(schema.visitorBlocks.workspaceId, workspaceId),
          inArray(schema.visitorBlocks.visitorRef, visitorIds),
          isNull(schema.visitorBlocks.unblockedAt)
        ))
      }
    })

    await restoreAttempted
    await new Promise(resolve => setTimeout(resolve, 75))
    expect(restoreAcquiredIdentityLock).toBe(false)
    releaseMark()
    await Promise.all([mark, restore])

    const visitor = await db.query.visitors.findFirst({ where: eq(schema.visitors.id, markVisitorId) })
    expect(await isVisitorMessagingBlocked(visitor!, db)).toBe(true)
    const finalMark = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, markConversationId)
    })
    const finalRestore = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, restoreConversationId)
    })
    expect(finalMark?.isSpam).toBe(true)
    expect(finalRestore?.isSpam).toBe(false)
  })
})
