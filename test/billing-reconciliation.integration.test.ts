import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import { eq } from '../packages/db/node_modules/drizzle-orm/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import * as schema from '../packages/db/src/schema'
import { applyWorkspaceSubscriptionState, reconcileWorkspaceBilling, reconcileWorkspaceSubscriptionEvent, runBillingReconciliationSweep, startWorkspaceCheckout, workspaceEntitlement } from '../server/utils/billing'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('billing reconciliation database integration', () => {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema })
  const workspaceId = randomUUID()
  const checkoutId = `checkout_${randomUUID()}`
  const subscriptionId = `subscription_${randomUUID()}`
  let reference = ''
  let checkoutStatus: 'succeeded' | 'refunded' = 'succeeded'
  let checkoutAmount = '9.00'
  let providerRequests: string[] = []

  function checkoutPayload() {
    return {
      checkout_id: checkoutId,
      status: 'completed',
      payment_status: 'succeeded',
      amount: checkoutAmount,
      currency: 'USD',
      reference,
      charge: {
        payment_id: `payment_${checkoutId}`,
        status: checkoutStatus,
        amount: checkoutAmount,
        amount_paid: checkoutAmount,
        currency: 'USD'
      }
    }
  }

  function subscriptionPayload() {
    return {
      id: subscriptionId,
      status: 'active',
      current_period_end: '2026-10-01T00:00:00.000Z',
      cancel_at_period_end: false,
      metadata: { workspaceId, invoiceReference: reference, perchPlan: 'workspace_pro', interval: 'monthly' },
      product: { id: 'product_monthly', metadata: { perch_plan: 'workspace_pro_monthly' } }
    }
  }

  beforeAll(async () => {
    Object.assign(globalThis, {
      useDb: () => db,
      useRuntimeConfig: () => ({
        bachsEnvironment: 'sandbox',
        bachsSecretKey: 'sk_sandbox_test',
        bachsWebhookSecret: 'whsec_test',
        billingCheckoutEnabled: false
      })
    })
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Billing reconciliation workspace',
      siteId: `ws_${randomUUID().replaceAll('-', '').slice(0, 10)}`
    })
  })

  beforeEach(() => {
    reference = `invoice_${randomUUID()}`
    checkoutStatus = 'succeeded'
    checkoutAmount = '9.00'
    providerRequests = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      providerRequests.push(url)
      const payload = url.includes('/checkout-sessions/') ? checkoutPayload() : subscriptionPayload()
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await db.delete(schema.billingReconciliationJobs).where(eq(schema.billingReconciliationJobs.workspaceId, workspaceId))
    await db.delete(schema.workspaceSubscriptions).where(eq(schema.workspaceSubscriptions.workspaceId, workspaceId))
    await db.delete(schema.workspaceInvoices).where(eq(schema.workspaceInvoices.workspaceId, workspaceId))
  })

  afterAll(async () => {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
    await client.end()
  })

  async function insertInvoice(status: 'pending' | 'paid' | 'failed' = 'pending') {
    await db.insert(schema.workspaceInvoices).values({
      workspaceId,
      reference,
      status,
      interval: 'monthly',
      amountCents: 900,
      currency: 'USD',
      bachsCheckoutId: checkoutId,
      paidAt: status === 'paid' ? new Date('2026-09-01T00:00:00Z') : null,
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-10-01T00:00:00Z')
    })
  }

  it('recovers missed payment and subscription updates idempotently from canonical provider data', async () => {
    await insertInvoice()
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'canceled',
      interval: 'monthly',
      bachsSubscriptionId: subscriptionId,
      lastInvoiceReference: reference
    })

    const first = await reconcileWorkspaceBilling(workspaceId)
    expect(first).toMatchObject({ invoicesChecked: 1, invoicesChanged: 1, subscriptionChecked: true, awaitingSubscription: false, providerResourcesChecked: 2, providerRequestCap: 6 })
    expect(providerRequests).toHaveLength(2)
    expect((await workspaceEntitlement(workspaceId)).isPro).toBe(true)

    const second = await reconcileWorkspaceBilling(workspaceId)
    expect(second.invoicesChanged).toBe(0)
    expect(providerRequests).toHaveLength(4)
    expect((await workspaceEntitlement(workspaceId)).isPro).toBe(true)
  })

  it('confirms payment but keeps Pro off when the provider subscription identity is unavailable', async () => {
    await insertInvoice()
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'canceled',
      interval: 'monthly',
      lastInvoiceReference: reference
    })

    const result = await reconcileWorkspaceBilling(workspaceId)
    expect(result.awaitingSubscription).toBe(true)
    expect(result.providerResourcesChecked).toBe(1)
    expect(result.providerRequestCap).toBe(3)
    expect(providerRequests).toHaveLength(1)
    expect((await workspaceEntitlement(workspaceId)).isPro).toBe(false)
    expect((await db.query.workspaceInvoices.findFirst({ where: eq(schema.workspaceInvoices.reference, reference) }))?.status).toBe('paid')
  })

  it('does not mutate local billing when canonical amount validation fails', async () => {
    await insertInvoice()
    checkoutAmount = '8.00'
    await expect(reconcileWorkspaceBilling(workspaceId)).rejects.toThrow('did not match the local invoice')
    expect((await db.query.workspaceInvoices.findFirst({ where: eq(schema.workspaceInvoices.reference, reference) }))?.status).toBe('pending')
  })

  it('revokes access after a canonical full refund', async () => {
    await insertInvoice('paid')
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'active',
      interval: 'monthly',
      currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
      bachsSubscriptionId: subscriptionId,
      lastInvoiceReference: reference
    })
    checkoutStatus = 'refunded'

    const result = await reconcileWorkspaceBilling(workspaceId)
    expect(result.invoicesChanged).toBe(1)
    expect((await workspaceEntitlement(workspaceId)).isPro).toBe(false)
    expect((await db.query.workspaceInvoices.findFirst({ where: eq(schema.workspaceInvoices.reference, reference) }))?.status).toBe('failed')
  })

  it('preserves an existing active subscription when replacement checkout is rejected', async () => {
    await insertInvoice('paid')
    const periodEnd = new Date('2026-10-01T00:00:00Z')
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'active',
      interval: 'monthly',
      currentPeriodEnd: periodEnd,
      bachsSubscriptionId: subscriptionId,
      lastInvoiceReference: reference
    })

    await expect(startWorkspaceCheckout({
      workspaceId,
      interval: 'yearly',
      requestId: randomUUID(),
      customer: { email: 'billing@example.com', name: 'Billing Admin' },
      origin: 'https://staging.useperch.xyz'
    })).rejects.toThrow('already active')
    const row = await db.query.workspaceSubscriptions.findFirst({
      where: eq(schema.workspaceSubscriptions.workspaceId, workspaceId)
    })
    expect(row).toMatchObject({
      bachsSubscriptionId: subscriptionId,
      lastInvoiceReference: reference,
      status: 'active'
    })
    expect(row?.currentPeriodEnd?.toISOString()).toBe(periodEnd.toISOString())
    expect(providerRequests).toHaveLength(0)
  })

  it('replaces an expired subscription only after a newer canonical checkout lineage succeeds', async () => {
    const oldReference = `old_${randomUUID()}`
    await db.insert(schema.workspaceInvoices).values({
      workspaceId,
      reference: oldReference,
      status: 'paid',
      interval: 'monthly',
      amountCents: 900,
      currency: 'USD',
      bachsCheckoutId: `old_checkout_${randomUUID()}`,
      paidAt: new Date('2026-07-01T00:00:00Z'),
      periodStart: new Date('2026-07-01T00:00:00Z'),
      periodEnd: new Date('2026-08-01T00:00:00Z'),
      createdAt: new Date('2026-07-01T00:00:00Z')
    })
    await insertInvoice('paid')
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'canceled',
      interval: 'monthly',
      currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
      bachsSubscriptionId: `old_subscription_${randomUUID()}`,
      lastInvoiceReference: oldReference
    })

    const outcome = await applyWorkspaceSubscriptionState(subscriptionPayload())
    expect(outcome.applied).toBe(true)
    const row = await db.query.workspaceSubscriptions.findFirst({
      where: eq(schema.workspaceSubscriptions.workspaceId, workspaceId)
    })
    expect(row).toMatchObject({
      bachsSubscriptionId: subscriptionId,
      lastInvoiceReference: reference,
      status: 'active'
    })
  })

  it('rejects a delayed subscription update from an older checkout lineage', async () => {
    await insertInvoice('paid')
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'canceled',
      interval: 'monthly',
      lastInvoiceReference: `new_${randomUUID()}`
    })
    const outcome = await applyWorkspaceSubscriptionState(subscriptionPayload())
    expect(outcome).toMatchObject({ applied: false, reason: 'stale-invoice' })
  })

  it('serializes manual and automatic checks and requeues a request that arrives during a claim', async () => {
    await insertInvoice()
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'canceled',
      interval: 'monthly',
      bachsSubscriptionId: subscriptionId,
      lastInvoiceReference: reference
    })
    await db.insert(schema.billingReconciliationJobs).values({
      workspaceId,
      status: 'pending',
      nextAttemptAt: new Date('2026-09-02T00:00:00Z')
    })

    let releaseCheckout!: () => void
    let checkoutStarted!: () => void
    const checkoutWaiting = new Promise<void>((resolve) => {
      checkoutStarted = resolve
    })
    const checkoutRelease = new Promise<void>((resolve) => {
      releaseCheckout = resolve
    })
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      providerRequests.push(url)
      if (url.includes('/checkout-sessions/')) {
        checkoutStarted()
        await checkoutRelease
        return new Response(JSON.stringify(checkoutPayload()), { status: 200 })
      }
      return new Response(JSON.stringify(subscriptionPayload()), { status: 200 })
    }))

    const first = reconcileWorkspaceBilling(workspaceId)
    await checkoutWaiting
    await expect(reconcileWorkspaceBilling(workspaceId, { source: 'sweep' })).resolves.toBeNull()
    await expect(reconcileWorkspaceBilling(workspaceId)).rejects.toThrow('already being checked')
    expect(providerRequests).toHaveLength(2)
    releaseCheckout()
    await first

    const job = await db.query.billingReconciliationJobs.findFirst({
      where: eq(schema.billingReconciliationJobs.workspaceId, workspaceId)
    })
    expect(job?.status).toBe('pending')
    expect(job?.requestedAt).toBeNull()
    expect(job?.claimToken).toBeNull()
  })

  it('uses one guarded subscription snapshot plus one checkout read for a subscription webhook', async () => {
    await insertInvoice('paid')
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'active',
      interval: 'monthly',
      bachsSubscriptionId: subscriptionId,
      lastInvoiceReference: reference,
      currentPeriodEnd: new Date('2026-09-15T00:00:00Z')
    })
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      providerRequests.push(url)
      if (url.includes('/checkout-sessions/')) {
        return new Response(JSON.stringify(checkoutPayload()), { status: 200 })
      }
      return new Response(JSON.stringify({
        ...subscriptionPayload(),
        current_period_end: '2026-10-01T00:00:00.000Z'
      }), { status: 200 })
    }))

    await reconcileWorkspaceSubscriptionEvent(subscriptionId)
    const row = await db.query.workspaceSubscriptions.findFirst({
      where: eq(schema.workspaceSubscriptions.workspaceId, workspaceId)
    })
    expect(row?.currentPeriodEnd?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(providerRequests.filter(url => url.includes('/subscriptions/'))).toHaveLength(1)
    expect(providerRequests).toHaveLength(2)
  })

  it('requeues a late subscription snapshot instead of overwriting a newer completed reconciliation', async () => {
    await insertInvoice('paid')
    const originalEnd = new Date('2026-11-01T00:00:00Z')
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'active',
      interval: 'monthly',
      currentPeriodEnd: originalEnd,
      bachsSubscriptionId: subscriptionId,
      lastInvoiceReference: reference
    })
    let releaseSnapshot!: () => void
    let snapshotStarted!: () => void
    const snapshotWaiting = new Promise<void>((resolve) => {
      snapshotStarted = resolve
    })
    const snapshotRelease = new Promise<void>((resolve) => {
      releaseSnapshot = resolve
    })
    let subscriptionReads = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/checkout-sessions/')) {
        return new Response(JSON.stringify(checkoutPayload()), { status: 200 })
      }
      subscriptionReads++
      if (subscriptionReads === 1) {
        snapshotStarted()
        await snapshotRelease
        return new Response(JSON.stringify({
          ...subscriptionPayload(),
          current_period_end: '2026-10-01T00:00:00.000Z'
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        ...subscriptionPayload(),
        current_period_end: '2026-12-01T00:00:00.000Z'
      }), { status: 200 })
    }))

    const webhook = reconcileWorkspaceSubscriptionEvent(subscriptionId)
    await snapshotWaiting
    await reconcileWorkspaceBilling(workspaceId)
    releaseSnapshot()
    await expect(webhook).rejects.toThrow('already being checked')

    const row = await db.query.workspaceSubscriptions.findFirst({
      where: eq(schema.workspaceSubscriptions.workspaceId, workspaceId)
    })
    expect(row?.currentPeriodEnd?.toISOString()).toBe('2026-12-01T00:00:00.000Z')
    const job = await db.query.billingReconciliationJobs.findFirst({
      where: eq(schema.billingReconciliationJobs.workspaceId, workspaceId)
    })
    expect(job?.status).toBe('pending')
  })

  it('automatically processes only one claimed due job across overlapping sweeps', async () => {
    await insertInvoice()
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'canceled',
      interval: 'monthly',
      bachsSubscriptionId: subscriptionId,
      lastInvoiceReference: reference
    })
    await db.insert(schema.billingReconciliationJobs).values({
      workspaceId,
      status: 'pending',
      nextAttemptAt: new Date('2026-09-02T00:00:00Z')
    })
    let release!: () => void
    let started!: () => void
    const providerStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const providerRelease = new Promise<void>((resolve) => {
      release = resolve
    })
    let firstRequest = true
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      providerRequests.push(url)
      if (firstRequest) {
        firstRequest = false
        started()
        await providerRelease
      }
      const payload = url.includes('/checkout-sessions/') ? checkoutPayload() : subscriptionPayload()
      return new Response(JSON.stringify(payload), { status: 200 })
    }))

    const firstSweep = runBillingReconciliationSweep({ now: new Date('2026-09-02T01:00:00Z') })
    await providerStarted
    const secondSweep = await runBillingReconciliationSweep({ now: new Date('2026-09-02T01:00:00Z') })
    expect(secondSweep.checked).toBe(0)
    expect(providerRequests).toHaveLength(1)
    release()
    expect(await firstSweep).toMatchObject({ checked: 1, failed: 0 })
    expect(providerRequests).toHaveLength(2)
  })

  it('recovers a stale claim and clears its obsolete token', async () => {
    await insertInvoice()
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'canceled',
      interval: 'monthly',
      bachsSubscriptionId: subscriptionId,
      lastInvoiceReference: reference
    })
    await db.insert(schema.billingReconciliationJobs).values({
      workspaceId,
      status: 'processing',
      claimToken: 'obsolete-claim',
      claimedAt: new Date('2026-09-02T00:40:00Z'),
      nextAttemptAt: new Date('2026-09-02T00:00:00Z')
    })

    expect(await runBillingReconciliationSweep({ now: new Date('2026-09-02T01:00:01Z') }))
      .toMatchObject({ checked: 1, failed: 0 })
    const job = await db.query.billingReconciliationJobs.findFirst({
      where: eq(schema.billingReconciliationJobs.workspaceId, workspaceId)
    })
    expect(job?.claimToken).toBeNull()
    expect(job?.lastCheckedAt).toBeInstanceOf(Date)
  })

  it('dead-letters repeated provider failures and lets an admin recover safely', async () => {
    await insertInvoice()
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'canceled',
      interval: 'monthly',
      bachsSubscriptionId: subscriptionId,
      lastInvoiceReference: reference
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ malformed: true }), { status: 200 })))

    for (let attempt = 0; attempt < 6; attempt++) {
      await expect(reconcileWorkspaceBilling(workspaceId, {
        now: new Date(`2026-09-02T0${attempt + 1}:00:00Z`)
      })).rejects.toThrow('invalid subscription')
    }
    let job = await db.query.billingReconciliationJobs.findFirst({
      where: eq(schema.billingReconciliationJobs.workspaceId, workspaceId)
    })
    expect(job).toMatchObject({ status: 'failed', attempts: 6, nextAttemptAt: null })

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      const payload = url.includes('/checkout-sessions/') ? checkoutPayload() : subscriptionPayload()
      return new Response(JSON.stringify(payload), { status: 200 })
    }))
    await reconcileWorkspaceBilling(workspaceId, { now: new Date('2026-09-02T08:00:00Z') })
    job = await db.query.billingReconciliationJobs.findFirst({
      where: eq(schema.billingReconciliationJobs.workspaceId, workspaceId)
    })
    expect(job?.attempts).toBe(0)
    expect(job?.status).toBe('pending')
  })
})
