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
      periodEnd: new Date('2026-10-01T00:00:00.000Z')
    })
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'active',
      interval: 'monthly',
      currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
      bachsSubscriptionId: subscriptionId,
      lastInvoiceReference: reference
    })
    return subscriptionId
  }

  beforeAll(() => {
    Object.assign(globalThis, {
      useDb: () => db,
      useRuntimeConfig: () => ({ billingCheckoutEnabled: true })
    })
  })

  afterEach(async () => {
    if (workspaceIds.length) {
      await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, workspaceIds))
      await db.delete(schema.billingDeletionReceipts).where(inArray(schema.billingDeletionReceipts.workspaceId, workspaceIds))
    }
    if (userIds.length) await db.delete(schema.users).where(inArray(schema.users.id, userIds))
    workspaceIds.splice(0)
    userIds.splice(0)
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

  it('keeps the workspace when Bachs times out and allows a safe retry', async () => {
    const userId = await createUser()
    const workspaceId = await createWorkspace(userId)
    const subscriptionId = await addPaidSubscription(workspaceId)
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

    const billing = await confirmSubscriptionWillNotRenew(requirement, {
      getSubscription: vi.fn().mockResolvedValue({
        id: subscriptionId,
        status: 'active',
        cancel_at_period_end: true,
        metadata: null
      }),
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
      periodEnd: new Date('2026-10-01T00:00:00.000Z')
    })

    await expect(prepareWorkspaceDeletion({ workspaceId, userId, confirmation: 'Delete Me' }))
      .rejects.toMatchObject({
        statusCode: 409,
        statusMessage: 'Perch cannot confirm the billing-provider subscription. Nothing was deleted; contact support or try again after billing syncs.'
      })
    expect(await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, workspaceId) }))
      .toMatchObject({ deletionRequestedAt: null })
  })

  it('rolls back final deletion when billing changes after provider confirmation', async () => {
    const userId = await createUser()
    const workspaceId = await createWorkspace(userId)
    const subscriptionId = await addPaidSubscription(workspaceId)
    const requirement = await prepareWorkspaceDeletion({ workspaceId, userId, confirmation: 'Delete Me' })
    const billing = await confirmSubscriptionWillNotRenew(requirement, {
      getSubscription: vi.fn().mockResolvedValue({
        id: subscriptionId,
        status: 'canceled',
        cancel_at_period_end: false,
        metadata: null
      }),
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
    } finally {
      await client`delete from test_billing_deletion_blockers where workspace_id = ${workspaceId}`
    }
  })

  it('deletes sole-member workspaces with an account but preserves shared workspaces', async () => {
    const userId = await createUser()
    const teammateId = await createUser('Teammate')
    const soloWorkspaceId = await createWorkspace(userId)
    const subscriptionId = await addPaidSubscription(soloWorkspaceId)
    const sharedWorkspaceId = await createWorkspace(userId, 'agent', 'Shared Workspace')
    await db.insert(schema.workspaceMembers).values({ workspaceId: sharedWorkspaceId, userId: teammateId, role: 'admin' })

    const preparation = await prepareAccountDeletion(userId)
    expect(preparation.requirements).toEqual([{ workspaceId: soloWorkspaceId, subscriptionId }])
    const confirmations = await Promise.all(preparation.requirements.map(requirement =>
      confirmSubscriptionWillNotRenew(requirement, {
        getSubscription: vi.fn().mockResolvedValue({
          id: subscriptionId,
          status: 'active',
          cancel_at_period_end: true,
          metadata: null
        }),
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
})
