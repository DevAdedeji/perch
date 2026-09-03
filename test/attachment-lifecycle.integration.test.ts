import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import { and, eq, inArray } from '../packages/db/node_modules/drizzle-orm/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import * as schema from '../packages/db/src/schema'
import {
  ATTACHMENT_ABANDONED_AFTER_MS,
  ATTACHMENT_CLEANUP_MAX_ATTEMPTS,
  ATTACHMENT_CLEANUP_STALE_MS,
  claimLogoAttachment,
  claimMessageAttachment,
  finalizeAttachmentAssetRegistration,
  queueAssetCleanup,
  queueWorkspaceAttachmentCleanup,
  registerAttachmentAsset,
  retryFailedAttachmentCleanup,
  runAttachmentCleanupSweep
} from '../server/utils/attachment-lifecycle'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('secure attachment lifecycle', () => {
  const client = postgres(databaseUrl!, { max: 12 })
  const db = drizzle(client, { schema })
  const userId = randomUUID()
  const otherUserId = randomUUID()
  const workspaceId = randomUUID()
  const otherWorkspaceId = randomUUID()
  const visitorRef = randomUUID()
  const otherVisitorRef = randomUUID()
  const conversationId = randomUUID()
  const createdIds: string[] = []

  beforeAll(async () => {
    Object.assign(globalThis, {
      useRuntimeConfig: () => ({
        cloudinaryCloudName: 'perch-test',
        cloudinaryApiKey: 'test-key',
        cloudinaryApiSecret: 'test-secret'
      })
    })
    // This database is dedicated to this feature suite. Clear artifacts from
    // an interrupted prior run so the global cleanup worker has deterministic work.
    await db.delete(schema.attachmentAssets)
    await db.insert(schema.users).values([
      { id: userId, email: `${userId}@example.test`, name: 'Owner' },
      { id: otherUserId, email: `${otherUserId}@example.test`, name: 'Other' }
    ])
    await db.insert(schema.workspaces).values([
      { id: workspaceId, name: 'Attachments', siteId: `site_${randomUUID()}` },
      { id: otherWorkspaceId, name: 'Other', siteId: `site_${randomUUID()}` }
    ])
    await db.insert(schema.visitors).values([
      { id: visitorRef, workspaceId, visitorId: `visitor_${randomUUID()}` },
      { id: otherVisitorRef, workspaceId, visitorId: `visitor_${randomUUID()}` }
    ])
    await db.insert(schema.conversations).values({
      id: conversationId,
      workspaceId,
      visitorRef
    })
  })

  afterAll(async () => {
    if (createdIds.length) {
      await db.delete(schema.attachmentAssets).where(inArray(schema.attachmentAssets.id, createdIds))
    }
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, otherWorkspaceId))
    await db.delete(schema.users).where(eq(schema.users.id, userId))
    await db.delete(schema.users).where(eq(schema.users.id, otherUserId))
    await client.end()
  })

  async function asset(input: Partial<typeof schema.attachmentAssets.$inferInsert> = {}) {
    const id = randomUUID()
    createdIds.push(id)
    return registerAttachmentAsset({
      workspaceId,
      uploaderUserId: userId,
      kind: 'message',
      publicId: `perch/${workspaceId}/${id}`,
      secureUrl: `https://res.cloudinary.com/perch-test/image/upload/v1/perch/${workspaceId}/${id}.png`,
      mimeType: 'image/png',
      byteSize: 128,
      ...input
    }, db)
  }

  it('atomically claims an upload once and binds it to one message', async () => {
    const uploaded = await asset()
    const attempts = await Promise.allSettled([1, 2].map(() => db.transaction(async (tx) => {
      const claimed = await claimMessageAttachment(tx, {
        workspaceId,
        secureUrl: uploaded.secureUrl,
        uploaderUserId: userId
      })
      return tx.insert(schema.messages).values({
        conversationId,
        senderType: 'agent',
        content: '',
        attachmentUrl: claimed.secureUrl,
        attachmentType: claimed.mimeType,
        attachmentAssetId: claimed.id
      }).returning()
    })))
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1)
    const messages = await db.query.messages.findMany({
      where: eq(schema.messages.attachmentAssetId, uploaded.id)
    })
    expect(messages).toHaveLength(1)
  })

  it('records a provider identity before upload and only finalizes the matching intent', async () => {
    const intent = await asset({
      secureUrl: `https://res.cloudinary.com/perch-test/image/upload/perch/${workspaceId}/${randomUUID()}`,
      byteSize: 64
    })
    const deliveredUrl = `https://res.cloudinary.com/perch-test/image/upload/v1/${intent.publicId}.png`
    const finalized = await finalizeAttachmentAssetRegistration({
      assetId: intent.id,
      publicId: intent.publicId,
      secureUrl: deliveredUrl,
      byteSize: 128
    }, db)
    expect(finalized.secureUrl).toBe(deliveredUrl)
    expect(finalized.byteSize).toBe(128)
    await expect(finalizeAttachmentAssetRegistration({
      assetId: intent.id,
      publicId: `perch/${workspaceId}/${randomUUID()}`,
      secureUrl: deliveredUrl,
      byteSize: 128
    }, db)).rejects.toThrow('no longer pending')
  })

  it('enforces one owner and valid message/logo scope in the database', async () => {
    await expect(asset({ visitorRef })).rejects.toMatchObject({ cause: { code: '23514' } })
    await expect(asset({ workspaceId: null })).rejects.toMatchObject({ cause: { code: '23514' } })
    await expect(asset({
      workspaceId: null,
      uploaderUserId: null,
      visitorRef,
      kind: 'logo'
    })).rejects.toMatchObject({ cause: { code: '23514' } })
  })

  it('rejects cross-workspace, cross-uploader, cross-visitor, and arbitrary URLs', async () => {
    const uploaded = await asset()
    const cases = [
      { workspaceId: otherWorkspaceId, secureUrl: uploaded.secureUrl, uploaderUserId: userId },
      { workspaceId, secureUrl: uploaded.secureUrl, uploaderUserId: otherUserId },
      { workspaceId, secureUrl: uploaded.secureUrl, visitorRef: otherVisitorRef },
      { workspaceId, secureUrl: 'https://res.cloudinary.com/perch-test/image/upload/v1/perch/forged.png', uploaderUserId: userId }
    ]
    for (const input of cases) {
      await expect(db.transaction(tx => claimMessageAttachment(tx, input))).rejects.toMatchObject({ statusCode: 400 })
    }
    expect((await db.query.attachmentAssets.findFirst({ where: eq(schema.attachmentAssets.id, uploaded.id) }))?.state).toBe('pending')
  })

  it('claims visitor uploads only for the exact visitor session owner', async () => {
    const uploaded = await asset({ uploaderUserId: null, visitorRef })
    await expect(db.transaction(tx => claimMessageAttachment(tx, {
      workspaceId,
      secureUrl: uploaded.secureUrl,
      visitorRef: otherVisitorRef
    }))).rejects.toMatchObject({ statusCode: 400 })
    const claimed = await db.transaction(tx => claimMessageAttachment(tx, {
      workspaceId,
      secureUrl: uploaded.secureUrl,
      visitorRef
    }))
    expect(claimed.id).toBe(uploaded.id)
  })

  it('cleans abandoned uploads but never a claimed message asset', async () => {
    const abandoned = await asset()
    const claimed = await asset()
    const now = new Date('2026-09-03T12:00:00.000Z')
    await db.update(schema.attachmentAssets).set({
      createdAt: new Date(now.getTime() - ATTACHMENT_ABANDONED_AFTER_MS - 1)
    }).where(inArray(schema.attachmentAssets.id, [abandoned.id, claimed.id]))
    await db.transaction(tx => claimMessageAttachment(tx, {
      workspaceId,
      secureUrl: claimed.secureUrl,
      uploaderUserId: userId
    }))
    const deleted: string[] = []
    await runAttachmentCleanupSweep({
      db,
      now,
      transport: async ({ publicId }) => {
        deleted.push(publicId)
        return { result: 'ok' }
      }
    })
    expect(deleted).toEqual([abandoned.publicId])
    expect((await db.query.attachmentAssets.findFirst({ where: eq(schema.attachmentAssets.id, abandoned.id) }))?.state).toBe('deleted')
    expect((await db.query.attachmentAssets.findFirst({ where: eq(schema.attachmentAssets.id, claimed.id) }))?.state).toBe('claimed')
  })

  it('treats provider not-found as idempotent cleanup success', async () => {
    const uploaded = await asset()
    const now = new Date('2026-09-03T12:00:00.000Z')
    await db.transaction(tx => queueAssetCleanup(tx, uploaded.id, 'logo_removed', now))
    await runAttachmentCleanupSweep({ db, now, transport: async () => ({ result: 'not found' }) })
    expect((await db.query.attachmentAssets.findFirst({ where: eq(schema.attachmentAssets.id, uploaded.id) }))?.state).toBe('deleted')
  })

  it.each([
    ['timeout', async () => { throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }],
    ['provider failure', async () => { throw Object.assign(new Error('unavailable'), { status: 503 }) }],
    ['malformed response', async () => ({ unexpected: true })]
  ])('retries a %s with bounded attempts and privacy-safe persisted errors', async (_name, transport) => {
    const uploaded = await asset()
    let now = new Date('2026-09-03T12:00:00.000Z')
    await db.transaction(tx => queueAssetCleanup(tx, uploaded.id, 'logo_removed', now))
    for (let attempt = 1; attempt <= ATTACHMENT_CLEANUP_MAX_ATTEMPTS; attempt++) {
      await runAttachmentCleanupSweep({ db, now, transport })
      const row = await db.query.attachmentAssets.findFirst({ where: eq(schema.attachmentAssets.id, uploaded.id) })
      expect(row?.cleanupAttempts).toBe(attempt)
      expect(row?.cleanupLastError).not.toContain(uploaded.publicId)
      expect(row?.state).toBe(attempt === ATTACHMENT_CLEANUP_MAX_ATTEMPTS ? 'dead_letter' : 'retrying')
      now = new Date((row?.cleanupNextAttemptAt?.getTime() ?? now.getTime()) + 1)
    }
  })

  it('allows an operator to requeue an exhausted cleanup exactly once', async () => {
    const uploaded = await asset()
    await db.update(schema.attachmentAssets).set({
      state: 'dead_letter',
      cleanupAttempts: ATTACHMENT_CLEANUP_MAX_ATTEMPTS,
      cleanupLastError: '{"type":"Error"}'
    }).where(eq(schema.attachmentAssets.id, uploaded.id))
    await retryFailedAttachmentCleanup(uploaded.id, db)
    const retried = await db.query.attachmentAssets.findFirst({ where: eq(schema.attachmentAssets.id, uploaded.id) })
    expect(retried?.state).toBe('retrying')
    expect(retried?.cleanupAttempts).toBe(0)
    expect(retried?.cleanupLastError).toBeNull()
    await expect(retryFailedAttachmentCleanup(uploaded.id, db)).rejects.toMatchObject({ statusCode: 409 })
    await db.update(schema.attachmentAssets).set({ state: 'deleted', cleanupNextAttemptAt: null })
      .where(eq(schema.attachmentAssets.id, uploaded.id))
  })

  it('limits provider concurrency and two sweepers never claim the same asset', async () => {
    const now = new Date('2026-09-03T12:00:00.000Z')
    const uploads = await Promise.all(Array.from({ length: 8 }, () => asset()))
    for (const uploaded of uploads) await db.transaction(tx => queueAssetCleanup(tx, uploaded.id, 'logo_removed', now))
    let active = 0
    let peak = 0
    const calls = new Map<string, number>()
    const transport = async ({ publicId }: { publicId: string }) => {
      active++
      peak = Math.max(peak, active)
      calls.set(publicId, (calls.get(publicId) ?? 0) + 1)
      await new Promise(resolve => setTimeout(resolve, 10))
      active--
      return { result: 'ok' }
    }
    await Promise.all([
      runAttachmentCleanupSweep({ db, now, concurrency: 3, transport }),
      runAttachmentCleanupSweep({ db, now, concurrency: 3, transport })
    ])
    expect(peak).toBeLessThanOrEqual(6)
    expect([...calls.values()].every(count => count === 1)).toBe(true)
    expect(calls.size).toBe(8)
  })

  it('fences a stale worker after a newer worker reclaims its cleanup lease', async () => {
    const uploaded = await asset()
    const firstNow = new Date('2026-09-03T12:00:00.000Z')
    const secondNow = new Date(firstNow.getTime() + ATTACHMENT_CLEANUP_STALE_MS + 1)
    await db.transaction(tx => queueAssetCleanup(tx, uploaded.id, 'logo_removed', firstNow))

    let rejectFirst!: (error: Error) => void
    let resolveSecond!: (value: { result: 'ok' }) => void
    let firstStarted!: () => void
    let secondStarted!: () => void
    const firstReady = new Promise<void>((resolve) => {
      firstStarted = resolve
    })
    const secondReady = new Promise<void>((resolve) => {
      secondStarted = resolve
    })
    const firstResponse = new Promise<never>((_resolve, reject) => {
      rejectFirst = reject
    })
    const secondResponse = new Promise<{ result: 'ok' }>((resolve) => {
      resolveSecond = resolve
    })

    const firstSweep = runAttachmentCleanupSweep({
      db,
      now: firstNow,
      transport: async () => {
        firstStarted()
        return firstResponse
      }
    })
    await firstReady

    const secondSweep = runAttachmentCleanupSweep({
      db,
      now: secondNow,
      transport: async () => {
        secondStarted()
        return secondResponse
      }
    })
    await secondReady

    rejectFirst(new Error('late stale failure'))
    await firstSweep
    const reclaimed = await db.query.attachmentAssets.findFirst({
      where: eq(schema.attachmentAssets.id, uploaded.id)
    })
    expect(reclaimed?.state).toBe('processing')
    expect(reclaimed?.cleanupAttempts).toBe(2)
    expect(reclaimed?.cleanupLockedAt?.getTime()).toBe(secondNow.getTime())

    resolveSecond({ result: 'ok' })
    await secondSweep
    expect((await db.query.attachmentAssets.findFirst({
      where: eq(schema.attachmentAssets.id, uploaded.id)
    }))?.state).toBe('deleted')
  })

  it('dead-letters an exhausted stale lease without making another provider call', async () => {
    const uploaded = await asset()
    const now = new Date('2026-09-03T12:00:00.000Z')
    await db.update(schema.attachmentAssets).set({
      state: 'processing',
      cleanupAttempts: ATTACHMENT_CLEANUP_MAX_ATTEMPTS,
      cleanupLockedAt: new Date(now.getTime() - ATTACHMENT_CLEANUP_STALE_MS - 1)
    }).where(eq(schema.attachmentAssets.id, uploaded.id))
    let calls = 0
    await runAttachmentCleanupSweep({
      db,
      now,
      transport: async () => {
        calls++
        return { result: 'ok' }
      }
    })
    const exhausted = await db.query.attachmentAssets.findFirst({
      where: eq(schema.attachmentAssets.id, uploaded.id)
    })
    expect(calls).toBe(0)
    expect(exhausted?.state).toBe('dead_letter')
    expect(exhausted?.cleanupAttempts).toBe(ATTACHMENT_CLEANUP_MAX_ATTEMPTS)
    expect(exhausted?.cleanupLockedAt).toBeNull()
  })

  it('keeps cleanup jobs durable after workspace deletion and handles logos deliberately', async () => {
    const doomedWorkspaceId = randomUUID()
    const doomedVisitorId = randomUUID()
    const doomedConversationId = randomUUID()
    const legacyMessageUrl = `https://res.cloudinary.com/perch-test/image/upload/v1/perch/${doomedWorkspaceId}/legacy-message.png`
    await db.insert(schema.workspaces).values({
      id: doomedWorkspaceId,
      name: 'Doomed',
      siteId: `site_${randomUUID()}`,
      logoUrl: `https://res.cloudinary.com/perch-test/image/upload/v1/perch/${doomedWorkspaceId}/legacy-logo.png`
    })
    await db.insert(schema.visitors).values({
      id: doomedVisitorId,
      workspaceId: doomedWorkspaceId,
      visitorId: `visitor_${randomUUID()}`
    })
    await db.insert(schema.conversations).values({
      id: doomedConversationId,
      workspaceId: doomedWorkspaceId,
      visitorRef: doomedVisitorId
    })
    await db.insert(schema.messages).values({
      conversationId: doomedConversationId,
      senderType: 'visitor',
      content: '',
      attachmentUrl: legacyMessageUrl,
      attachmentType: 'image/png'
    })
    const foreignUpload = await asset({ workspaceId: otherWorkspaceId })
    await db.update(schema.attachmentAssets).set({
      state: 'claimed',
      claimedAt: new Date()
    }).where(eq(schema.attachmentAssets.id, foreignUpload.id))
    await db.insert(schema.messages).values({
      conversationId: doomedConversationId,
      senderType: 'visitor',
      content: '',
      attachmentUrl: foreignUpload.secureUrl,
      attachmentType: 'image/png'
    })
    const upload = await asset({ workspaceId: doomedWorkspaceId })
    await db.update(schema.attachmentAssets).set({
      state: 'dead_letter',
      cleanupAttempts: ATTACHMENT_CLEANUP_MAX_ATTEMPTS
    }).where(eq(schema.attachmentAssets.id, upload.id))
    await db.transaction(async (tx) => {
      await queueWorkspaceAttachmentCleanup(tx, {
        workspaceId: doomedWorkspaceId,
        uploaderUserId: userId,
        legacyLogoUrl: `https://res.cloudinary.com/perch-test/image/upload/v1/perch/${doomedWorkspaceId}/legacy-logo.png`
      })
      await tx.delete(schema.workspaces).where(eq(schema.workspaces.id, doomedWorkspaceId))
    })
    const tracked = await db.query.attachmentAssets.findMany({
      where: and(
        eq(schema.attachmentAssets.workspaceId, doomedWorkspaceId),
        eq(schema.attachmentAssets.state, 'retrying')
      )
    })
    expect(tracked.map(row => row.publicId).sort()).toEqual([
      upload.publicId,
      `perch/${doomedWorkspaceId}/legacy-message`,
      `perch/${doomedWorkspaceId}/legacy-logo`
    ].sort())
    expect(tracked.find(row => row.id === upload.id)?.cleanupAttempts).toBe(0)
    expect((await db.query.attachmentAssets.findFirst({
      where: eq(schema.attachmentAssets.id, foreignUpload.id)
    }))?.state).toBe('claimed')
    createdIds.push(...tracked.filter(row => row.id !== upload.id).map(row => row.id))
  })

  it('claims a logo once, binds it to the workspace, and queues replacement', async () => {
    const logo = await asset({ workspaceId: null, kind: 'logo' })
    const claimed = await db.transaction(tx => claimLogoAttachment(tx, {
      workspaceId,
      secureUrl: logo.secureUrl,
      uploaderUserId: userId
    }))
    expect(claimed.workspaceId).toBe(workspaceId)
    await expect(db.transaction(tx => claimLogoAttachment(tx, {
      workspaceId,
      secureUrl: logo.secureUrl,
      uploaderUserId: userId
    }))).rejects.toMatchObject({ statusCode: 400 })
    await db.transaction(tx => queueAssetCleanup(tx, logo.id, 'logo_replaced'))
    expect((await db.query.attachmentAssets.findFirst({ where: eq(schema.attachmentAssets.id, logo.id) }))?.cleanupReason).toBe('logo_replaced')
  })
})
