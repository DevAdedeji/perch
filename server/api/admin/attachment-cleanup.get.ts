import { asc, attachmentAssets, inArray } from '@perch/db'

/** Privacy-safe operational queue: never exposes URLs, public ids, or owners. */
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event)
  const rows = await useDb().select({
    id: attachmentAssets.id,
    state: attachmentAssets.state,
    kind: attachmentAssets.kind,
    reason: attachmentAssets.cleanupReason,
    attempts: attachmentAssets.cleanupAttempts,
    nextAttemptAt: attachmentAssets.cleanupNextAttemptAt,
    lastError: attachmentAssets.cleanupLastError,
    createdAt: attachmentAssets.createdAt,
    updatedAt: attachmentAssets.updatedAt
  }).from(attachmentAssets).where(inArray(
    attachmentAssets.state,
    ['processing', 'retrying', 'dead_letter']
  )).orderBy(asc(attachmentAssets.createdAt)).limit(100)

  return rows.map(row => ({
    ...row,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }))
})
