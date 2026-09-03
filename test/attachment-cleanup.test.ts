import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachmentCleanupRetryAt,
  destroyAttachmentAsset
} from '../server/utils/attachment-lifecycle'
import { signCloudinaryParams } from '../server/utils/cloudinary'

describe('attachment cleanup provider boundary', () => {
  beforeEach(() => {
    Object.assign(globalThis, {
      useRuntimeConfig: () => ({
        cloudinaryCloudName: 'perch-test',
        cloudinaryApiKey: 'test-key',
        cloudinaryApiSecret: 'test-secret'
      })
    })
  })

  it.each(['ok', 'not found'] as const)('accepts the idempotent %s response', async (result) => {
    const transport = vi.fn(async () => ({ result }))
    const now = new Date('2026-09-03T12:00:00.000Z')
    await destroyAttachmentAsset('perch/workspace/image', { transport, now })
    expect(transport).toHaveBeenCalledWith({
      cloudName: 'perch-test',
      apiKey: 'test-key',
      publicId: 'perch/workspace/image',
      timestamp: 1788436800,
      signature: signCloudinaryParams({
        public_id: 'perch/workspace/image',
        timestamp: 1788436800,
        invalidate: 'true'
      }, 'test-secret'),
      timeoutMs: 10_000
    })
  })

  it('fails closed on malformed provider responses', async () => {
    await expect(destroyAttachmentAsset('perch/workspace/image', {
      transport: async () => ({ result: 'maybe' })
    })).rejects.toThrow('invalid deletion response')
  })

  it('propagates a provider timeout for the durable worker to retry', async () => {
    const timeout = Object.assign(new Error('provider timeout'), { code: 'ETIMEDOUT' })
    await expect(destroyAttachmentAsset('perch/workspace/image', {
      transport: async () => { throw timeout }
    })).rejects.toBe(timeout)
  })

  it('bounds retry delays after the configured backoff schedule', () => {
    const now = new Date('2026-09-03T12:00:00.000Z')
    expect(attachmentCleanupRetryAt(1, now).getTime() - now.getTime()).toBe(30_000)
    expect(attachmentCleanupRetryAt(999, now).getTime() - now.getTime()).toBe(60 * 60_000)
  })
})

describe('attachment lifecycle migration', () => {
  it('reserves migration 0030 and installs ownership and cleanup invariants', () => {
    const journal = JSON.parse(readFileSync(
      new URL('../packages/db/migrations/meta/_journal.json', import.meta.url),
      'utf8'
    ))
    const migration = readFileSync(
      new URL('../packages/db/migrations/0030_attachment-lifecycle.sql', import.meta.url),
      'utf8'
    )
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 30))
      .toMatchObject({ idx: 30, tag: '0030_attachment-lifecycle' })
    expect(migration).toContain('attachment_assets_owner_ck')
    expect(migration).toContain('attachment_assets_scope_ck')
    expect(migration).toContain('attachment_assets_public_id_unique')
    expect(migration).toContain('messages_attachment_asset_uq')
  })
})
