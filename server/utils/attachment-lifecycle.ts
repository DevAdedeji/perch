import {
  and,
  asc,
  attachmentAssets,
  eq,
  inArray,
  lt,
  or,
  sql
} from '@perch/db'
import type { Database } from '@perch/db'
import { z } from 'zod'
import { cloudinaryConfig, cloudinaryPublicIdFromUrl, signCloudinaryParams } from './cloudinary'
import { safeErrorSummary } from './request-security'

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DbExecutor = Database | DbTransaction

export const ATTACHMENT_ABANDONED_AFTER_MS = 24 * 60 * 60_000
export const ATTACHMENT_CLEANUP_MAX_ATTEMPTS = 5
export const ATTACHMENT_CLEANUP_CLAIM_LIMIT = 10
export const ATTACHMENT_CLEANUP_STALE_MS = 10 * 60_000
const CLEANUP_RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000]
const CLOUDINARY_DESTROY_TIMEOUT_MS = 10_000

const destroyResponseSchema = z.object({ result: z.enum(['ok', 'not found']) })

export type AttachmentDestroyTransport = (input: {
  cloudName: string
  apiKey: string
  publicId: string
  timestamp: number
  signature: string
  timeoutMs: number
}) => Promise<unknown>

export function attachmentCleanupRetryAt(attempt: number, now = new Date()): Date {
  const delay = CLEANUP_RETRY_DELAYS_MS[Math.max(0, Math.min(CLEANUP_RETRY_DELAYS_MS.length - 1, attempt - 1))]!
  return new Date(now.getTime() + delay)
}

export async function defaultAttachmentDestroyTransport(input: Parameters<AttachmentDestroyTransport>[0]) {
  const form = new FormData()
  form.append('public_id', input.publicId)
  form.append('timestamp', String(input.timestamp))
  form.append('invalidate', 'true')
  form.append('api_key', input.apiKey)
  form.append('signature', input.signature)
  return $fetch<unknown>(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(input.cloudName)}/image/destroy`,
    { method: 'POST', body: form, timeout: input.timeoutMs }
  )
}

export async function destroyAttachmentAsset(
  publicId: string,
  options: { transport?: AttachmentDestroyTransport, now?: Date } = {}
): Promise<void> {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig()
  if (!cloudName || !apiKey || !apiSecret) throw new Error('Cloudinary cleanup is not configured')
  const timestamp = Math.floor((options.now ?? new Date()).getTime() / 1000)
  const params = { public_id: publicId, timestamp, invalidate: 'true' }
  const response = await (options.transport ?? defaultAttachmentDestroyTransport)({
    cloudName,
    apiKey,
    publicId,
    timestamp,
    signature: signCloudinaryParams(params, apiSecret),
    timeoutMs: CLOUDINARY_DESTROY_TIMEOUT_MS
  })
  if (!destroyResponseSchema.safeParse(response).success) {
    throw new Error('Cloudinary returned an invalid deletion response')
  }
}

export async function registerAttachmentAsset(input: {
  workspaceId: string | null
  uploaderUserId?: string | null
  visitorRef?: string | null
  kind: 'message' | 'logo'
  publicId: string
  secureUrl: string
  mimeType: string
  byteSize: number
}, db: Database = useDb()) {
  const [asset] = await db.insert(attachmentAssets).values({
    workspaceId: input.workspaceId,
    uploaderUserId: input.uploaderUserId ?? null,
    visitorRef: input.visitorRef ?? null,
    kind: input.kind,
    publicId: input.publicId,
    secureUrl: input.secureUrl,
    mimeType: input.mimeType,
    byteSize: input.byteSize
  }).returning()
  return asset!
}

export async function claimMessageAttachment(tx: DbTransaction, input: {
  workspaceId: string
  secureUrl: string
  uploaderUserId?: string
  visitorRef?: string
}) {
  const owner = input.uploaderUserId
    ? eq(attachmentAssets.uploaderUserId, input.uploaderUserId)
    : input.visitorRef
      ? eq(attachmentAssets.visitorRef, input.visitorRef)
      : sql`false`
  const [asset] = await tx.update(attachmentAssets).set({
    state: 'claimed',
    claimedAt: sql`now()`,
    updatedAt: sql`now()`
  }).where(and(
    eq(attachmentAssets.workspaceId, input.workspaceId),
    eq(attachmentAssets.secureUrl, input.secureUrl),
    eq(attachmentAssets.kind, 'message'),
    eq(attachmentAssets.state, 'pending'),
    owner
  )).returning()
  if (!asset) {
    throw createError({ statusCode: 400, statusMessage: 'Attachment is invalid, expired, or already used' })
  }
  return asset
}

export async function claimLogoAttachment(tx: DbTransaction, input: {
  workspaceId: string
  secureUrl: string
  uploaderUserId: string
}) {
  const [asset] = await tx.update(attachmentAssets).set({
    workspaceId: input.workspaceId,
    state: 'claimed',
    claimedAt: sql`now()`,
    updatedAt: sql`now()`
  }).where(and(
    or(eq(attachmentAssets.workspaceId, input.workspaceId), sql`${attachmentAssets.workspaceId} is null`),
    eq(attachmentAssets.uploaderUserId, input.uploaderUserId),
    eq(attachmentAssets.secureUrl, input.secureUrl),
    eq(attachmentAssets.kind, 'logo'),
    eq(attachmentAssets.state, 'pending')
  )).returning()
  if (!asset) throw createError({ statusCode: 400, statusMessage: 'Logo upload is invalid, expired, or already used' })
  return asset
}

export async function queueAssetCleanup(
  tx: DbExecutor,
  assetId: string,
  reason: 'logo_replaced' | 'logo_removed' | 'workspace_deleted' | 'account_deleted',
  now = new Date()
) {
  await tx.update(attachmentAssets).set({
    state: 'retrying',
    cleanupAttempts: sql`case when ${attachmentAssets.state} = 'dead_letter' then 0 else ${attachmentAssets.cleanupAttempts} end`,
    cleanupReason: reason,
    cleanupNextAttemptAt: now,
    cleanupLockedAt: null,
    cleanupLastError: null,
    updatedAt: sql`now()`
  }).where(and(
    eq(attachmentAssets.id, assetId),
    inArray(attachmentAssets.state, ['pending', 'claimed', 'retrying', 'dead_letter'])
  ))
}

export async function queueLegacyLogoCleanup(
  tx: DbExecutor,
  input: {
    workspaceId: string
    uploaderUserId: string
    secureUrl: string
    reason: 'logo_replaced' | 'logo_removed' | 'workspace_deleted'
  },
  now = new Date()
) {
  const config = cloudinaryConfig()
  const publicId = cloudinaryPublicIdFromUrl(input.secureUrl, config.cloudName)
  if (!publicId) return
  await tx.insert(attachmentAssets).values({
    workspaceId: input.workspaceId,
    uploaderUserId: input.uploaderUserId,
    kind: 'logo',
    publicId,
    secureUrl: input.secureUrl,
    mimeType: 'image/*',
    byteSize: 0,
    state: 'retrying',
    cleanupReason: input.reason,
    cleanupNextAttemptAt: now
  }).onConflictDoUpdate({
    target: attachmentAssets.publicId,
    set: {
      state: 'retrying',
      cleanupAttempts: sql`case when ${attachmentAssets.state} = 'dead_letter' then 0 else ${attachmentAssets.cleanupAttempts} end`,
      cleanupReason: input.reason,
      cleanupNextAttemptAt: now,
      cleanupLockedAt: null,
      cleanupLastError: null,
      updatedAt: sql`now()`
    }
  })
}

export async function queueWorkspaceAttachmentCleanup(
  tx: DbTransaction,
  input: { workspaceId: string, uploaderUserId: string, legacyLogoUrl?: string | null },
  now = new Date()
) {
  await tx.update(attachmentAssets).set({
    state: 'retrying',
    cleanupAttempts: sql`case when ${attachmentAssets.state} = 'dead_letter' then 0 else ${attachmentAssets.cleanupAttempts} end`,
    cleanupReason: 'workspace_deleted',
    cleanupNextAttemptAt: now,
    cleanupLockedAt: null,
    cleanupLastError: null,
    updatedAt: sql`now()`
  }).where(and(
    eq(attachmentAssets.workspaceId, input.workspaceId),
    inArray(attachmentAssets.state, ['pending', 'claimed', 'retrying', 'dead_letter'])
  ))

  if (!input.legacyLogoUrl) return
  await queueLegacyLogoCleanup(tx, {
    workspaceId: input.workspaceId,
    uploaderUserId: input.uploaderUserId,
    secureUrl: input.legacyLogoUrl,
    reason: 'workspace_deleted'
  }, now)
}

export async function queueUnattachedUserUploads(
  tx: DbTransaction,
  userId: string,
  now = new Date()
) {
  await tx.update(attachmentAssets).set({
    state: 'retrying',
    cleanupReason: 'account_deleted',
    cleanupNextAttemptAt: now,
    cleanupLockedAt: null,
    cleanupLastError: null,
    updatedAt: sql`now()`
  }).where(and(
    eq(attachmentAssets.uploaderUserId, userId),
    eq(attachmentAssets.state, 'pending')
  ))
}

export async function retryFailedAttachmentCleanup(
  assetId: string,
  db: Database = useDb(),
  now = new Date()
) {
  const [asset] = await db.update(attachmentAssets).set({
    state: 'retrying',
    cleanupAttempts: 0,
    cleanupNextAttemptAt: now,
    cleanupLockedAt: null,
    cleanupLastError: null,
    updatedAt: sql`now()`
  }).where(and(
    eq(attachmentAssets.id, assetId),
    eq(attachmentAssets.state, 'dead_letter')
  )).returning({ id: attachmentAssets.id })
  if (!asset) throw createError({ statusCode: 409, statusMessage: 'Cleanup is not awaiting manual retry' })
  return asset
}

async function claimCleanupAssets(db: Database, now: Date) {
  return db.transaction(async (tx) => {
    const abandonedBefore = new Date(now.getTime() - ATTACHMENT_ABANDONED_AFTER_MS)
    const staleBefore = new Date(now.getTime() - ATTACHMENT_CLEANUP_STALE_MS)
    const rows = await tx.select().from(attachmentAssets).where(or(
      and(eq(attachmentAssets.state, 'pending'), lt(attachmentAssets.createdAt, abandonedBefore)),
      and(eq(attachmentAssets.state, 'retrying'), lt(attachmentAssets.cleanupNextAttemptAt, new Date(now.getTime() + 1))),
      and(eq(attachmentAssets.state, 'processing'), lt(attachmentAssets.cleanupLockedAt, staleBefore))
    )).orderBy(asc(attachmentAssets.cleanupNextAttemptAt), asc(attachmentAssets.createdAt))
      .limit(ATTACHMENT_CLEANUP_CLAIM_LIMIT)
      .for('update', { skipLocked: true })
    if (!rows.length) return []
    return tx.update(attachmentAssets).set({
      state: 'processing',
      cleanupReason: sql`coalesce(${attachmentAssets.cleanupReason}, 'abandoned_upload')`,
      cleanupAttempts: sql`case when ${attachmentAssets.state} = 'processing' then ${attachmentAssets.cleanupAttempts} else ${attachmentAssets.cleanupAttempts} + 1 end`,
      cleanupLockedAt: now,
      cleanupNextAttemptAt: null,
      updatedAt: sql`now()`
    }).where(inArray(attachmentAssets.id, rows.map(row => row.id))).returning()
  })
}

export async function runAttachmentCleanupSweep(options: {
  db?: Database
  now?: Date
  transport?: AttachmentDestroyTransport
  concurrency?: number
} = {}) {
  const db = options.db ?? useDb()
  const now = options.now ?? new Date()
  const claimed = await claimCleanupAssets(db, now)
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 5))
  let index = 0
  const workers = Array.from({ length: Math.min(concurrency, claimed.length) }, async () => {
    while (index < claimed.length) {
      const asset = claimed[index++]!
      try {
        await destroyAttachmentAsset(asset.publicId, { transport: options.transport, now })
        await db.update(attachmentAssets).set({
          state: 'deleted',
          deletedAt: now,
          cleanupLockedAt: null,
          cleanupNextAttemptAt: null,
          cleanupLastError: null,
          updatedAt: sql`now()`
        }).where(and(eq(attachmentAssets.id, asset.id), eq(attachmentAssets.state, 'processing')))
        console.info('[attachments] cleanup completed', { assetId: asset.id, attempts: asset.cleanupAttempts })
      } catch (error) {
        const final = asset.cleanupAttempts >= ATTACHMENT_CLEANUP_MAX_ATTEMPTS
        await db.update(attachmentAssets).set({
          state: final ? 'dead_letter' : 'retrying',
          cleanupNextAttemptAt: final ? null : attachmentCleanupRetryAt(asset.cleanupAttempts, now),
          cleanupLockedAt: null,
          cleanupLastError: JSON.stringify(safeErrorSummary(error)).slice(0, 500),
          updatedAt: sql`now()`
        }).where(and(eq(attachmentAssets.id, asset.id), eq(attachmentAssets.state, 'processing')))
        console.error('[attachments] cleanup failed', {
          assetId: asset.id,
          attempts: asset.cleanupAttempts,
          final,
          ...safeErrorSummary(error)
        })
      }
    }
  })
  await Promise.all(workers)
  return { claimed: claimed.length }
}
