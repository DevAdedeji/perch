import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import { eq, inArray } from '../packages/db/node_modules/drizzle-orm/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import * as schema from '../packages/db/src/schema'
import {
  confirmSubscriptionWillNotRenew,
  finalizeAccountDeletion,
  finalizeWorkspaceDeletion,
  prepareAccountDeletion,
  prepareWorkspaceDeletion,
  recordBillingDeletionConfirmation
} from '../server/utils/billing-deletion'
import { startWorkspaceCheckout } from '../server/utils/billing'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('billing-safe deletion database integration', () => {
  const client = postgres(databaseUrl!, { max: 4 })
  const db = drizzle(client, { schema })
  const userIds: string[] = []
  const workspaceIds: string[] = []
  const attachmentIds: string[] = []

  async function addAttachment(input: {
    workspaceId: string | null
    uploaderUserId: string
    state?: 'pending' | 'claimed'
    kind?: 'message' | 'logo'
  }) {
    const id = randomUUID()
    attachmentIds.push(id)
    const publicId = `perch/deletion-tests/${id}`
    const [asset] = await db.insert(schema.attachmentAssets).values({
      id,
      workspaceId: input.workspaceId,
      uploaderUserId: input.uploaderUserId,
      kind: input.kind ?? 'message',
      publicId,
      secureUrl: `https://res.cloudinary.com/perch-test/image/upload/v1/${publicId}.png`,
      mimeType: 'image/png',
      byteSize: 128,
      state: input.state ?? 'pending',
      claimedAt: input.state === 'claimed' ? new Date() : null
    }).returning()
    return asset!
  }

  async function createUser(name = 'Deletion Admin') {
    const id = randomUUID()
    userIds.push(id)
    await db.insert(schema.users).values({
      id,
      email: `delete-${id}@example.com`,
      name
    })
    return id
  }

  async function createWorkspace(userId: string, role: 'admin' | 'agent' = 'admin', name = 'Delete Me') {
    const id = randomUUID()
    workspaceIds.push(id)
    await db.insert(schema.workspaces).values({
      id,
      name,
      siteId: `ws_${randomUUID().replaceAll('-', '').slice(0, 12)}`
    })
    await db.insert(schema.workspaceMembers).values({ workspaceId: id, userId, role })
    return id
  }

  async function addPaidSubscription(workspaceId: string, subscriptionId = `sub_${randomUUID()}`) {
    const reference = `invoice_${randomUUID()}`
    await db.insert(schema.workspaceInvoices).values({
      workspaceId,
      reference,
      status: 'paid',
      interval: 'monthly',
      amountCents: 900,
      periodStart: new Date('2026-09-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-01T00:00:00.000Z'),
      checkoutClosedAt: new Date('2026-09-01T00:00:00.000Z')
    })
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'active',
      interval: 'monthly',
      currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
      bachsSubscriptionId: subscriptionId,
      lastInvoiceReference: reference
    })
    return { subscriptionId, reference }
  }

  function providerSubscription(
    workspaceId: string,
    invoiceReference: string,
    subscriptionId: string,
    status: 'active' | 'canceled' = 'active',
    cancelAtPeriodEnd = true
  ) {
    return {
      id: subscriptionId,
      status,
      cancel_at_period_end: cancelAtPeriodEnd,
      current_period_end: '2026-10-01T00:00:00.000Z',
      metadata: { workspaceId, invoiceReference, perchPlan: 'workspace_pro', interval: 'monthly' },
      product: {
        id: 'product-monthly',
        price: { currency: 'USD', price_type: 'fixed' as const, amount: '9.00' },
        billing_cycle: { interval: 'month' as const, frequency: 1 },
        metadata: { perch_plan: 'workspace_pro_monthly' }
      }
    }
  }

  beforeAll(() => {
    Object.assign(globalThis, {
      useDb: () => db,
      useRuntimeConfig: () => ({ billingCheckoutEnabled: true, cloudinaryCloudName: 'perch-test' })
    })
  })

  afterEach(async () => {
    if (attachmentIds.length) await db.delete(schema.attachmentAssets).where(inArray(schema.attachmentAssets.id, attachmentIds))
    if (workspaceIds.length) {
      await db.delete(schema.attachmentAssets).where(inArray(schema.attachmentAssets.workspaceId, workspaceIds))
    }
    if (workspaceIds.length) {
      await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, workspaceIds))
      await db.delete(schema.billingDeletionReceipts).where(inArray(schema.billingDeletionReceipts.workspaceId, workspaceIds))
    }
    if (userIds.length) await db.delete(schema.users).where(inArray(schema.users.id, userIds))
    workspaceIds.splice(0)
    userIds.splice(0)
    attachmentIds.splice(0)
  })

  afterAll(async () => {
    await client.end()
  })

  it('deletes a free workspace and keeps only a non-personal receipt', async () => {
    const userId = await createUser()
    const workspaceId = await createWorkspace(userId, 'admin', 'Exact Workspace')
    const requirement = await prepareWorkspaceDeletion({
      workspaceId,
      userId,
      confirmation: 'Exact Workspace'
    })
    const billing = await confirmSubscriptionWillNotRenew(requirement, {
      getSubscription: vi.fn(),
      cancelSubscription: vi.fn()
    })
    await recordBillingDeletionConfirmation(billing, 'workspace')
    await finalizeWorkspaceDeletion({
      workspaceId,
      userId,
      confirmationText: 'Exact Workspace',
      billing
    })

    expect(await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, workspaceId) })).toBeUndefined()
    expect(await db.query.billingDeletionReceipts.findFirst({
      where: eq(schema.billingDeletionReceipts.workspaceId, workspaceId)
    })).toMatchObject({
      deletionKind: 'workspace',
      bachsSubscriptionId: null,
      providerStatus: 'not_applicable',
      deletedAt: expect.any(Date)
    })

    // A stale duplicate may finish provider confirmation after the first
    // request deleted the workspace. It must not rewrite completed evidence.
    await recordBillingDeletionConfirmation({
      workspaceId,
      subscriptionId: null,
      invoiceReference: null,
      providerStatus: 'not_applicable',
      cancelAtPeriodEnd: null,
      providerConfirmedAt: null
    }, 'account')
    expect(await db.query.billingDeletionReceipts.findFirst({
      where: eq(schema.billingDeletionReceipts.workspaceId, workspaceId)
    })).toMatchObject({
      deletionKind: 'workspace',
      deletedAt: expect.any(Date)
    })
  })

  it('freezes checkout before provider work and is safe under duplicate finalization', async () => {
    const userId = await createUser()
    const workspaceId = await createWorkspace(userId)
    const requirement = await prepareWorkspaceDeletion({
      workspaceId,
      userId,
      confirmation: 'Delete Me'
    })
    await expect(startWorkspaceCheckout({
      workspaceId,
      interval: 'monthly',
      requestId: randomUUID(),
      customer: { email: 'buyer@example.com', name: 'Buyer' },
      origin: 'https://staging.useperch.test'
    })).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Workspace deletion has started, so a new paid checkout cannot be created.'
    })
    const billing = await confirmSubscriptionWillNotRenew(requirement, {
      getSubscription: vi.fn(),
      cancelSubscription: vi.fn()
    })
    await expect(Promise.all([
      finalizeWorkspaceDeletion({ workspaceId, userId, confirmationText: 'Delete Me', billing }),
      finalizeWorkspaceDeletion({ workspaceId, userId, confirmationText: 'Delete Me', billing })
    ])).resolves.toEqual([undefined, undefined])
    const receipts = await db.select().from(schema.billingDeletionReceipts)
      .where(eq(schema.billingDeletionReceipts.workspaceId, workspaceId))
    expect(receipts).toHaveLength(1)
  })

  it('keeps tracked and legacy assets queued after workspace deletion', async () => {
    const userId = await createUser()
    const workspaceId = await createWorkspace(userId, 'admin', 'Assets Workspace')
    const legacyLogoUrl = `https://res.cloudinary.com/perch-test/image/upload/v1/perch/${workspaceId}/legacy-logo.png`
    await db.update(schema.workspaces).set({ logoUrl: legacyLogoUrl })
      .where(eq(schema.workspaces.id, workspaceId))
    const tracked = await addAttachment({ workspaceId, uploaderUserId: userId, state: 'claimed' })
    const requirement = await prepareWorkspaceDeletion({ workspaceId, userId, confirmation: 'Assets Workspace' })
    const billing = await confirmSubscriptionWillNotRenew(requirement, {
      getSubscription: vi.fn(),
      cancelSubscription: vi.fn()
    })

    await finalizeWorkspaceDeletion({ workspaceId, userId, confirmationText: 'Assets Workspace', billing })

    const trackedAfterDeletion = await db.query.attachmentAssets.findFirst({ where: eq(schema.attachmentAssets.id, tracked.id) })
    expect(['retrying', 'processing', 'deleted']).toContain(trackedAfterDeletion?.state)
    expect(trackedAfterDeletion?.cleanupReason).toBe('workspace_deleted')
    const legacyLogoAfterDeletion = await db.query.attachmentAssets.findFirst({
      where: eq(schema.attachmentAssets.publicId, `perch/${workspaceId}/legacy-logo`)
    })
    expect(['retrying', 'processing', 'deleted']).toContain(legacyLogoAfterDeletion?.state)
    expect(legacyLogoAfterDeletion?.cleanupReason).toBe('workspace_deleted')
  })

  it('keeps the workspace when Bachs times out and allows a safe retry', async () => {
    const userId = await createUser()
    const workspaceId = await createWorkspace(userId)
    const { subscriptionId, reference } = await addPaidSubscription(workspaceId)
    const tracked = await addAttachment({ workspaceId, uploaderUserId: userId, state: 'claimed' })
    const requirement = await prepareWorkspaceDeletion({ workspaceId, userId, confirmation: 'Delete Me' })
    await expect(confirmSubscriptionWillNotRenew(requirement, {
      getSubscription: vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { statusCode: 503 })),
      cancelSubscription: vi.fn()
    })).rejects.toMatchObject({ statusCode: 503 })
    expect(await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, workspaceId) }))
      .toMatchObject({ deletionRequestedAt: expect.any(Date) })
    expect(await db.query.billingDeletionReceipts.findFirst({
      where: eq(schema.billingDeletionReceipts.workspaceId, workspaceId)
    })).toBeUndefined()
    expect(await db.query.attachmentAssets.findFirst({ where: eq(schema.attachmentAssets.id, tracked.id) }))
      .toMatchObject({ state: 'claimed', cleanupReason: null })

    const billing = await confirmSubscriptionWillNotRenew(requirement, {
      getSubscription: vi.fn().mockResolvedValue(providerSubscription(workspaceId, reference, subscriptionId)),
      cancelSubscription: vi.fn()
    })
    await finalizeWorkspaceDeletion({ workspaceId, userId, confirmationText: 'Delete Me', billing })
    expect(await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, workspaceId) })).toBeUndefined()
  })

  it('rejects unfinished checkout, wrong confirmation, non-admin, and cross-workspace access', async () => {
    const adminId = await createUser()
    const outsiderId = await createUser('Outsider')
    const workspaceId = await createWorkspace(adminId)
    await db.insert(schema.workspaceInvoices).values({
      workspaceId,
      reference: `pending_${randomUUID()}`,
      interval: 'monthly',
      amountCents: 900,
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60_000)
    })
    await expect(prepareWorkspaceDeletion({ workspaceId, userId: adminId, confirmation: 'Delete Me' }))
      .rejects.toMatchObject({ statusCode: 409 })
    await db.delete(schema.workspaceInvoices).where(eq(schema.workspaceInvoices.workspaceId, workspaceId))
    await expect(prepareWorkspaceDeletion({ workspaceId, userId: adminId, confirmation: 'wrong' }))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(prepareWorkspaceDeletion({ workspaceId, userId: outsiderId, confirmation: 'Delete Me' }))
      .rejects.toMatchObject({ statusCode: 403 })
    await db.insert(schema.workspaceMembers).values({ workspaceId, userId: outsiderId, role: 'agent' })
    await expect(prepareWorkspaceDeletion({ workspaceId, userId: outsiderId, confirmation: 'Delete Me' }))
      .rejects.toMatchObject({ statusCode: 403 })
    expect(await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, workspaceId) }))
      .toMatchObject({ deletionRequestedAt: null })
  })

  it('fails closed when a paid invoice has no provider subscription mapping', async () => {
    const userId = await createUser()
    const workspaceId = await createWorkspace(userId)
    await db.insert(schema.workspaceInvoices).values({
      workspaceId,
      reference: `paid_without_subscription_${randomUUID()}`,
      status: 'paid',
      interval: 'monthly',
      amountCents: 900,
      periodStart: new Date('2026-09-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-01T00:00:00.000Z'),
      checkoutClosedAt: new Date('2026-09-01T00:00:00.000Z')
    })

    await expect(prepareWorkspaceDeletion({ workspaceId, userId, confirmation: 'Delete Me' }))
      .rejects.toMatchObject({
        statusCode: 409,
        statusMessage: 'Perch cannot confirm the billing-provider subscription. Nothing was deleted; contact support or try again after billing syncs.'
      })
    expect(await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, workspaceId) }))
      .toMatchObject({ deletionRequestedAt: null })
  })

  it('blocks deletion while a checkout, reconciliation, or financial conflict is unresolved', async () => {
    const userId = await createUser()
    const workspaceId = await createWorkspace(userId)
    const invoiceId = randomUUID()
    await db.insert(schema.workspaceInvoices).values({
      id: invoiceId,
      workspaceId,
      reference: `paid_open_${randomUUID()}`,
      status: 'paid',
      interval: 'monthly',
      amountCents: 900,
      periodStart: new Date('2026-09-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-01T00:00:00.000Z')
    })
    await expect(prepareWorkspaceDeletion({ workspaceId, userId, confirmation: 'Delete Me' }))
      .rejects.toMatchObject({ statusCode: 409 })

    await db.update(schema.workspaceInvoices).set({ checkoutClosedAt: new Date() })
      .where(eq(schema.workspaceInvoices.id, invoiceId))
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'canceled',
      interval: 'monthly'
    })
    await db.insert(schema.billingReconciliationJobs).values({ workspaceId, status: 'processing' })
    await expect(prepareWorkspaceDeletion({ workspaceId, userId, confirmation: 'Delete Me' }))
      .rejects.toMatchObject({ statusCode: 409 })

    await db.update(schema.billingReconciliationJobs).set({ status: 'idle' })
      .where(eq(schema.billingReconciliationJobs.workspaceId, workspaceId))
    await db.insert(schema.billingFinancialConflicts).values({
      workspaceId,
      conflictingSubscriptionId: `sub_conflict_${randomUUID()}`
    })
    await expect(prepareWorkspaceDeletion({ workspaceId, userId, confirmation: 'Delete Me' }))
      .rejects.toMatchObject({
        statusCode: 409,
        statusMessage: 'Billing needs operator attention before this workspace can be deleted. Nothing was deleted; contact support.'
      })
    expect(await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, workspaceId) }))
      .toMatchObject({ deletionRequestedAt: null })
  })

  it('rolls back final deletion when billing changes after provider confirmation', async () => {
    const userId = await createUser()
    const workspaceId = await createWorkspace(userId)
    const { subscriptionId, reference } = await addPaidSubscription(workspaceId)
    const requirement = await prepareWorkspaceDeletion({ workspaceId, userId, confirmation: 'Delete Me' })
    const billing = await confirmSubscriptionWillNotRenew(requirement, {
      getSubscription: vi.fn().mockResolvedValue(providerSubscription(workspaceId, reference, subscriptionId, 'canceled', false)),
      cancelSubscription: vi.fn()
    })
    await db.update(schema.workspaceSubscriptions).set({ bachsSubscriptionId: `sub_${randomUUID()}` })
      .where(eq(schema.workspaceSubscriptions.workspaceId, workspaceId))
    await expect(finalizeWorkspaceDeletion({
      workspaceId,
      userId,
      confirmationText: 'Delete Me',
      billing
    })).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, workspaceId) })).toBeDefined()
    expect(await db.query.billingDeletionReceipts.findFirst({
      where: eq(schema.billingDeletionReceipts.workspaceId, workspaceId)
    })).toBeUndefined()
  })

  it('preserves provider evidence but does not mark deletion complete when the database fails', async () => {
    const userId = await createUser()
    const workspaceId = await createWorkspace(userId)
    const requirement = await prepareWorkspaceDeletion({ workspaceId, userId, confirmation: 'Delete Me' })
    const billing = await confirmSubscriptionWillNotRenew(requirement, {
      getSubscription: vi.fn(),
      cancelSubscription: vi.fn()
    })
    const tracked = await addAttachment({ workspaceId, uploaderUserId: userId, state: 'claimed' })
    await recordBillingDeletionConfirmation(billing, 'workspace')
    await client.unsafe(`
      create table if not exists test_billing_deletion_blockers (
        workspace_id uuid primary key references workspaces(id)
      )
    `)
    await client`insert into test_billing_deletion_blockers (workspace_id) values (${workspaceId})`
    try {
      await expect(finalizeWorkspaceDeletion({
        workspaceId,
        userId,
        confirmationText: 'Delete Me',
        billing
      })).rejects.toBeDefined()
      expect(await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, workspaceId) })).toBeDefined()
      expect(await db.query.billingDeletionReceipts.findFirst({
        where: eq(schema.billingDeletionReceipts.workspaceId, workspaceId)
      })).toMatchObject({
        providerStatus: 'not_applicable',
        deletedAt: null
      })
      expect(await db.query.attachmentAssets.findFirst({ where: eq(schema.attachmentAssets.id, tracked.id) }))
        .toMatchObject({ state: 'claimed', cleanupReason: null })
    } finally {
      await client`delete from test_billing_deletion_blockers where workspace_id = ${workspaceId}`
    }
  })

  it('deletes sole-member workspaces with an account but preserves shared workspaces', async () => {
    const userId = await createUser()
    const teammateId = await createUser('Teammate')
    const soloWorkspaceId = await createWorkspace(userId)
    const { subscriptionId, reference } = await addPaidSubscription(soloWorkspaceId)
    const sharedWorkspaceId = await createWorkspace(userId, 'agent', 'Shared Workspace')
    await db.insert(schema.workspaceMembers).values({ workspaceId: sharedWorkspaceId, userId: teammateId, role: 'admin' })
    const soloAsset = await addAttachment({ workspaceId: soloWorkspaceId, uploaderUserId: userId, state: 'claimed' })
    const sharedAsset = await addAttachment({ workspaceId: sharedWorkspaceId, uploaderUserId: userId, state: 'claimed' })
    const unattachedUpload = await addAttachment({ workspaceId: null, uploaderUserId: userId, kind: 'logo' })

    const preparation = await prepareAccountDeletion(userId)
    expect(preparation.requirements).toEqual([{
      workspaceId: soloWorkspaceId,
      subscriptionId,
      invoiceReference: reference
    }])
    const confirmations = await Promise.all(preparation.requirements.map(requirement =>
      confirmSubscriptionWillNotRenew(requirement, {
        getSubscription: vi.fn().mockResolvedValue(providerSubscription(soloWorkspaceId, reference, subscriptionId)),
        cancelSubscription: vi.fn()
      })
    ))
    const result = await finalizeAccountDeletion({
      userId,
      preparedWorkspaceIds: preparation.workspaceIds,
      billingConfirmations: confirmations
    })
    expect(result.soloWorkspaceIds).toEqual([soloWorkspaceId])
    expect(await db.query.users.findFirst({ where: eq(schema.users.id, userId) })).toBeUndefined()
    expect(await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, soloWorkspaceId) })).toBeUndefined()
    expect(await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, sharedWorkspaceId) })).toBeDefined()
    expect(await db.query.workspaceMembers.findFirst({
      where: eq(schema.workspaceMembers.userId, userId)
    })).toBeUndefined()
    expect(await db.query.billingDeletionReceipts.findFirst({
      where: eq(schema.billingDeletionReceipts.workspaceId, soloWorkspaceId)
    })).toMatchObject({ deletionKind: 'account', bachsSubscriptionId: subscriptionId })
    const soloAssetAfterDeletion = await db.query.attachmentAssets.findFirst({ where: eq(schema.attachmentAssets.id, soloAsset.id) })
    expect(['retrying', 'processing', 'deleted']).toContain(soloAssetAfterDeletion?.state)
    expect(soloAssetAfterDeletion?.cleanupReason).toBe('workspace_deleted')
    expect(await db.query.attachmentAssets.findFirst({ where: eq(schema.attachmentAssets.id, sharedAsset.id) }))
      .toMatchObject({ state: 'claimed', cleanupReason: null })
    const unattachedAfterDeletion = await db.query.attachmentAssets.findFirst({ where: eq(schema.attachmentAssets.id, unattachedUpload.id) })
    expect(['retrying', 'processing', 'deleted']).toContain(unattachedAfterDeletion?.state)
    expect(unattachedAfterDeletion?.cleanupReason).toBe('account_deleted')
  })

  it('blocks account deletion by a sole admin and when memberships change mid-flight', async () => {
    const userId = await createUser()
    const teammateId = await createUser('Teammate')
    const workspaceId = await createWorkspace(userId)
    await db.insert(schema.workspaceMembers).values({ workspaceId, userId: teammateId, role: 'agent' })
    await expect(prepareAccountDeletion(userId)).rejects.toMatchObject({ statusCode: 409 })

    await db.update(schema.workspaceMembers).set({ role: 'admin' })
      .where(eq(schema.workspaceMembers.userId, teammateId))
    const preparation = await prepareAccountDeletion(userId)
    const newWorkspaceId = await createWorkspace(userId)
    await expect(finalizeAccountDeletion({
      userId,
      preparedWorkspaceIds: preparation.workspaceIds,
      billingConfirmations: []
    })).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.query.users.findFirst({ where: eq(schema.users.id, userId) })).toBeDefined()
    expect(await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, newWorkspaceId) })).toBeDefined()
  })

  it('stops account deletion if a solo workspace gains a teammate during provider confirmation', async () => {
    const userId = await createUser()
    const teammateId = await createUser('Late teammate')
    const workspaceId = await createWorkspace(userId)
    const preparation = await prepareAccountDeletion(userId)
    const confirmations = await Promise.all(preparation.requirements.map(requirement =>
      confirmSubscriptionWillNotRenew(requirement, {
        getSubscription: vi.fn(),
        cancelSubscription: vi.fn()
      })
    ))
    await db.insert(schema.workspaceMembers).values({ workspaceId, userId: teammateId, role: 'agent' })

    await expect(finalizeAccountDeletion({
      userId,
      preparedWorkspaceIds: preparation.workspaceIds,
      billingConfirmations: confirmations
    })).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.query.users.findFirst({ where: eq(schema.users.id, userId) })).toBeDefined()
    expect(await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, workspaceId) })).toBeDefined()
  })
})
