import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import { eq } from '../packages/db/node_modules/drizzle-orm/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import * as schema from '../packages/db/src/schema'
import { cancelWorkspacePlan, claimBillingWebhook, failBillingWebhook, finishBillingWebhook, reconcileWorkspaceBilling, reconcileWorkspaceSubscriptionEvent, requireBillingWebhookFinish, runBillingReconciliationSweep, startWorkspaceCheckout, workspaceBillingCustomer, workspaceEntitlement } from '../server/utils/billing'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('billing reconciliation database integration', () => {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema })
  const workspaceId = randomUUID()
  const checkoutId = `checkout_${randomUUID()}`
  const subscriptionId = `subscription_${randomUUID()}`
  let reference = ''
  let checkoutStatus: 'succeeded' | 'failed' | 'refunded' = 'succeeded'
  let checkoutAmount = '9.00'
  let checkoutSubscriptionId: string | null = null
  let providerRequests: string[] = []

  function checkoutPayload(options: {
    chargeStatus?: typeof checkoutStatus
    sessionStatus?: 'open' | 'completed'
    paymentStatus?: 'processing' | 'succeeded'
    includeCharge?: boolean
  } = {}) {
    return {
      checkout_id: checkoutId,
      status: options.sessionStatus ?? 'completed',
      payment_status: options.paymentStatus ?? 'succeeded',
      amount: checkoutAmount,
      currency: 'USD',
      reference,
      subscription_id: checkoutSubscriptionId,
      charge: options.includeCharge === false
        ? null
        : {
            payment_id: `payment_${checkoutId}`,
            status: options.chargeStatus ?? checkoutStatus,
            amount: checkoutAmount,
            amount_paid: checkoutAmount,
            currency: 'USD'
          }
    }
  }

  function subscriptionPayload(options: {
    status?: 'active' | 'canceled'
    cancelAtPeriodEnd?: boolean
    currentPeriodEnd?: string
    workspaceId?: string
  } = {}) {
    return {
      id: subscriptionId,
      status: options.status ?? 'active',
      current_period_end: options.currentPeriodEnd ?? '2026-10-01T00:00:00.000Z',
      cancel_at_period_end: options.cancelAtPeriodEnd ?? false,
      metadata: { workspaceId: options.workspaceId ?? workspaceId, invoiceReference: reference, perchPlan: 'workspace_pro', interval: 'monthly' },
      product: { id: 'product_monthly', price: { currency: 'USD', price_type: 'fixed' as const, amount: '9.00' }, billing_cycle: { interval: 'month' as const, frequency: 1 }, metadata: { perch_plan: 'workspace_pro_monthly' } }
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
    checkoutSubscriptionId = subscriptionId
    providerRequests = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      providerRequests.push(url)
      const payload = url.includes('/checkout-sessions/')
        ? checkoutPayload()
        : init?.method === 'DELETE'
          ? subscriptionPayload({ cancelAtPeriodEnd: true })
          : subscriptionPayload()
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await db.delete(schema.billingFinancialConflicts).where(eq(schema.billingFinancialConflicts.workspaceId, workspaceId))
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
      bachsProductId: 'product_monthly',
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

  it('serializes distinct checkout requests before making one provider checkout call', async () => {
    let checkoutPosts = 0
    let releaseCheckout!: () => void
    let checkoutStarted!: () => void
    const started = new Promise<void>((resolve) => {
      checkoutStarted = resolve
    })
    const released = new Promise<void>((resolve) => {
      releaseCheckout = resolve
    })
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      providerRequests.push(url)
      if (url.includes('/products')) {
        return new Response(JSON.stringify({
          items: [{ id: 'product_monthly', price: { currency: 'USD', price_type: 'fixed' as const, amount: '9.00' }, billing_cycle: { interval: 'month' as const, frequency: 1 }, metadata: { perch_plan: 'workspace_pro_monthly' } }]
        }), { status: 200 })
      }
      if (url.endsWith('/checkout-sessions') && init?.method === 'POST') {
        checkoutPosts++
        const body = JSON.parse(String(init.body)) as { reference: string }
        reference = body.reference
        checkoutStarted()
        await released
        return new Response(JSON.stringify({
          checkout_id: checkoutId,
          checkout_url: 'https://checkout.bachs.io/session/serialized',
          reference
        }), { status: 200 })
      }
      return new Response(JSON.stringify(checkoutPayload()), { status: 200 })
    }))

    const first = startWorkspaceCheckout({
      workspaceId,
      interval: 'monthly',
      requestId: randomUUID(),
      customer: { email: 'verified@example.com', name: 'Verified Admin' },
      origin: 'https://staging.useperch.xyz'
    })
    await started
    await expect(startWorkspaceCheckout({
      workspaceId,
      interval: 'yearly',
      requestId: randomUUID(),
      customer: { email: 'verified@example.com', name: 'Verified Admin' },
      origin: 'https://staging.useperch.xyz'
    })).rejects.toThrow('monthly checkout is already open')
    await expect(startWorkspaceCheckout({
      workspaceId,
      interval: 'monthly',
      requestId: randomUUID(),
      customer: { email: 'verified@example.com', name: 'Verified Admin' },
      origin: 'https://staging.useperch.xyz'
    })).rejects.toThrow('already being prepared')
    expect(checkoutPosts).toBe(1)
    releaseCheckout()
    await expect(first).resolves.toMatchObject({
      checkoutUrl: 'https://checkout.bachs.io/session/serialized'
    })
    expect(checkoutPosts).toBe(1)
    expect(await db.query.workspaceInvoices.findMany({
      where: eq(schema.workspaceInvoices.workspaceId, workspaceId)
    })).toHaveLength(1)
  })

  it('requires the paying admin email to be verified before checkout', async () => {
    const userId = randomUUID()
    await db.insert(schema.users).values({
      id: userId,
      email: `unverified-${userId}@example.com`,
      name: 'Unverified Admin'
    })
    await db.insert(schema.workspaceMembers).values({
      workspaceId,
      userId,
      role: 'admin'
    })
    try {
      await expect(workspaceBillingCustomer(workspaceId, userId)).rejects.toThrow('Verify your email')
      await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, userId))
      await expect(workspaceBillingCustomer(workspaceId, userId)).resolves.toMatchObject({
        email: `unverified-${userId}@example.com`,
        name: 'Unverified Admin'
      })
    } finally {
      await db.delete(schema.workspaceMembers).where(eq(schema.workspaceMembers.userId, userId))
      await db.delete(schema.users).where(eq(schema.users.id, userId))
    }
  })

  it('reports honestly when a manual refresh has no provider resource to check', async () => {
    await expect(reconcileWorkspaceBilling(workspaceId)).rejects.toThrow(
      'There is no Bachs checkout or subscription connected'
    )
    expect(providerRequests).toHaveLength(0)
    expect(await db.query.billingReconciliationJobs.findFirst({
      where: eq(schema.billingReconciliationJobs.workspaceId, workspaceId)
    })).toMatchObject({ status: 'idle', attempts: 0 })
  })

  it('recovers a failed checkout that later becomes paid when its webhook was missed', async () => {
    checkoutSubscriptionId = null
    await insertInvoice('failed')
    await db.update(schema.workspaceInvoices).set({
      reconcileUntil: new Date('2026-09-03T00:00:00Z')
    }).where(eq(schema.workspaceInvoices.reference, reference))
    checkoutStatus = 'failed'

    const failed = await reconcileWorkspaceBilling(workspaceId, {
      now: new Date('2026-09-02T00:00:00Z')
    })
    expect(failed.nextCheckAt).toBe('2026-09-02T01:00:00.000Z')
    expect(failed.awaitingSubscription).toBe(false)

    checkoutStatus = 'succeeded'
    checkoutSubscriptionId = subscriptionId
    const recovered = await reconcileWorkspaceBilling(workspaceId, {
      now: new Date('2026-09-02T02:00:00Z')
    })
    expect(recovered).toMatchObject({
      invoicesChanged: 1,
      subscriptionChecked: true,
      subscriptionUpdated: true,
      providerResourcesChecked: 2,
      awaitingSubscription: false
    })
    expect((await workspaceEntitlement(workspaceId)).isPro).toBe(true)
  })

  it('uses the exact checkout-linked subscription instead of a stale canceled local ID', async () => {
    const oldReference = `old_${randomUUID()}`
    const oldSubscriptionId = `old_subscription_${randomUUID()}`
    await db.insert(schema.workspaceInvoices).values({
      workspaceId,
      reference: oldReference,
      status: 'paid',
      interval: 'monthly',
      amountCents: 900,
      currency: 'USD',
      bachsCheckoutId: `old_checkout_${randomUUID()}`,
      bachsProductId: 'product_monthly',
      checkoutClosedAt: new Date('2026-08-01T00:00:00Z'),
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
      bachsSubscriptionId: oldSubscriptionId,
      lastInvoiceReference: oldReference
    })
    checkoutSubscriptionId = subscriptionId

    const result = await reconcileWorkspaceBilling(workspaceId)
    expect(result).toMatchObject({ subscriptionChecked: true, subscriptionUpdated: true })
    expect(providerRequests.some(url => url.endsWith(`/subscriptions/${oldSubscriptionId}`))).toBe(false)
    expect(providerRequests.some(url => url.endsWith(`/subscriptions/${subscriptionId}`))).toBe(true)
    expect(await db.query.workspaceSubscriptions.findFirst({
      where: eq(schema.workspaceSubscriptions.workspaceId, workspaceId)
    })).toMatchObject({
      bachsSubscriptionId: subscriptionId,
      lastInvoiceReference: reference,
      status: 'active'
    })
  })

  it('stops polling a terminal checkout after its late-success window closes', async () => {
    checkoutSubscriptionId = null
    await insertInvoice('failed')
    await db.update(schema.workspaceInvoices).set({
      reconcileUntil: new Date('2026-09-02T01:00:00Z')
    }).where(eq(schema.workspaceInvoices.reference, reference))
    checkoutStatus = 'failed'

    const result = await reconcileWorkspaceBilling(workspaceId, {
      now: new Date('2026-09-02T01:00:01Z')
    })
    expect(result.nextCheckAt).toBeNull()
    const invoice = await db.query.workspaceInvoices.findFirst({
      where: eq(schema.workspaceInvoices.reference, reference)
    })
    expect(invoice?.checkoutClosedAt).toBeInstanceOf(Date)
    const job = await db.query.billingReconciliationJobs.findFirst({
      where: eq(schema.billingReconciliationJobs.workspaceId, workspaceId)
    })
    expect(job?.status).toBe('idle')
  })

  it('stops automatic polling and surfaces operator attention for an aged provider-pending checkout', async () => {
    checkoutSubscriptionId = null
    await insertInvoice()
    await db.update(schema.workspaceInvoices).set({
      reconcileUntil: new Date('2026-09-02T01:00:00Z')
    }).where(eq(schema.workspaceInvoices.reference, reference))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(checkoutPayload({
      sessionStatus: 'open',
      paymentStatus: 'processing',
      includeCharge: false
    })), { status: 200 })))

    await expect(reconcileWorkspaceBilling(workspaceId, {
      now: new Date('2026-09-02T01:00:01Z')
    })).rejects.toThrow('bounded verification window')
    const invoice = await db.query.workspaceInvoices.findFirst({
      where: eq(schema.workspaceInvoices.reference, reference)
    })
    expect(invoice?.checkoutClosedAt).toBeNull()
    expect(await db.query.billingReconciliationJobs.findFirst({
      where: eq(schema.billingReconciliationJobs.workspaceId, workspaceId)
    })).toMatchObject({
      status: 'failed',
      attempts: 6,
      nextAttemptAt: null,
      lastError: expect.stringContaining('operator review is required')
    })
    expect(await runBillingReconciliationSweep({
      now: new Date('2026-09-03T01:00:00Z')
    })).toMatchObject({ checked: 0, failed: 0 })
  })

  it('confirms payment but keeps Pro off when the provider subscription identity is unavailable', async () => {
    checkoutSubscriptionId = null
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

  it('rejects cancellation metadata for a different workspace without changing local renewal', async () => {
    await insertInvoice('paid')
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'active',
      interval: 'monthly',
      currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
      bachsSubscriptionId: subscriptionId,
      lastInvoiceReference: reference
    })
    const provider = vi.fn(async () => new Response(JSON.stringify(subscriptionPayload({
      cancelAtPeriodEnd: true,
      workspaceId: randomUUID()
    })), { status: 200 }))
    vi.stubGlobal('fetch', provider)

    await expect(cancelWorkspacePlan(workspaceId)).rejects.toThrow(
      'cancellation did not match this workspace billing record'
    )
    expect(await db.query.workspaceSubscriptions.findFirst({
      where: eq(schema.workspaceSubscriptions.workspaceId, workspaceId)
    })).toMatchObject({ cancelAtPeriodEnd: false, status: 'active' })
    expect(provider).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          'Idempotency-Key': `perch-cancel-${workspaceId}-${subscriptionId}`
        })
      })
    )
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
      checkoutClosedAt: new Date('2026-08-01T00:00:00Z'),
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

    const outcome = await reconcileWorkspaceSubscriptionEvent(subscriptionId)
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
    await expect(reconcileWorkspaceSubscriptionEvent(subscriptionId)).rejects.toThrow('operator refund review')
    expect(await db.query.billingFinancialConflicts.findFirst({
      where: eq(schema.billingFinancialConflicts.conflictingSubscriptionId, subscriptionId)
    })).toMatchObject({
      workspaceId,
      status: 'open',
      conflictingSubscriptionId: subscriptionId,
      invoiceReference: reference,
      attempts: 1
    })
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ method: 'DELETE' })
    )
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
    expect(providerRequests).toHaveLength(1)
    releaseCheckout()
    await first
    expect(providerRequests).toHaveLength(2)

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
      return new Response(JSON.stringify(subscriptionPayload({
        currentPeriodEnd: '2026-10-01T00:00:00.000Z'
      })), { status: 200 })
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
        return new Response(JSON.stringify(subscriptionPayload({
          currentPeriodEnd: '2026-10-01T00:00:00.000Z'
        })), { status: 200 })
      }
      return new Response(JSON.stringify(subscriptionPayload({
        currentPeriodEnd: '2026-12-01T00:00:00.000Z'
      })), { status: 200 })
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

  it('fences a reclaimed billing webhook so the expired handler cannot finish or fail it', async () => {
    const providerEventId = `event_${randomUUID()}`
    const first = await claimBillingWebhook(providerEventId, 'invoice.paid')
    expect(first.shouldProcess).toBe(true)
    await db.update(schema.billingWebhookDeliveries).set({
      updatedAt: new Date(Date.now() - 6 * 60_000)
    }).where(eq(schema.billingWebhookDeliveries.id, first.delivery.id))

    const reclaimed = await claimBillingWebhook(providerEventId, 'invoice.paid')
    expect(reclaimed.shouldProcess).toBe(true)
    expect(reclaimed.claimToken).not.toBe(first.claimToken)
    await expect(requireBillingWebhookFinish(first.delivery.id, first.claimToken!, 'completed'))
      .rejects.toThrow('newer webhook handler replaced this completion')
    expect(await failBillingWebhook(first.delivery.id, first.claimToken!, new Error('late failure'))).toBe(false)
    expect(await finishBillingWebhook(first.delivery.id, reclaimed.claimToken!, 'completed')).toBe(true)
    expect(await db.query.billingWebhookDeliveries.findFirst({
      where: eq(schema.billingWebhookDeliveries.id, first.delivery.id)
    })).toMatchObject({ status: 'completed', attempts: 2, claimToken: null, lastError: null })
    await db.delete(schema.billingWebhookDeliveries).where(eq(schema.billingWebhookDeliveries.id, first.delivery.id))
  })

  it('fences a lease-expired worker from regranting access after a newer refund and cancellation', async () => {
    await insertInvoice('paid')
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      status: 'active',
      interval: 'monthly',
      currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
      bachsSubscriptionId: subscriptionId,
      lastInvoiceReference: reference
    })
    let releaseOldCheckout!: () => void
    let oldCheckoutStarted!: () => void
    const oldStarted = new Promise<void>((resolve) => {
      oldCheckoutStarted = resolve
    })
    const oldReleased = new Promise<void>((resolve) => {
      releaseOldCheckout = resolve
    })
    let checkoutReads = 0
    let subscriptionReads = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/checkout-sessions/')) {
        checkoutReads++
        if (checkoutReads === 1) {
          oldCheckoutStarted()
          await oldReleased
          return new Response(JSON.stringify(checkoutPayload()), { status: 200 })
        }
        return new Response(JSON.stringify(checkoutPayload({ chargeStatus: 'refunded' })), { status: 200 })
      }
      subscriptionReads++
      return new Response(JSON.stringify(subscriptionReads === 1
        ? subscriptionPayload({ status: 'canceled', cancelAtPeriodEnd: true })
        : subscriptionPayload()), { status: 200 })
    }))

    const staleWorker = reconcileWorkspaceBilling(workspaceId, {
      now: new Date('2026-09-02T00:00:00Z')
    })
    await oldStarted
    const newerWorker = await reconcileWorkspaceBilling(workspaceId, {
      now: new Date('2026-09-02T00:11:00Z')
    })
    expect(newerWorker.invoicesChanged).toBe(1)
    expect((await workspaceEntitlement(workspaceId)).isPro).toBe(false)

    releaseOldCheckout()
    await expect(staleWorker).rejects.toThrow('newer billing check replaced')
    const invoice = await db.query.workspaceInvoices.findFirst({
      where: eq(schema.workspaceInvoices.reference, reference)
    })
    const subscription = await db.query.workspaceSubscriptions.findFirst({
      where: eq(schema.workspaceSubscriptions.workspaceId, workspaceId)
    })
    expect(invoice?.status).toBe('failed')
    expect(subscription?.status).toBe('active')
    expect((await workspaceEntitlement(workspaceId)).isPro).toBe(false)
  })

  it('dead-letters repeated provider failures and lets an admin recover safely', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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
      })).rejects.toThrow('invalid checkout session')
    }
    let job = await db.query.billingReconciliationJobs.findFirst({
      where: eq(schema.billingReconciliationJobs.workspaceId, workspaceId)
    })
    expect(job).toMatchObject({ status: 'failed', attempts: 6, nextAttemptAt: null })
    expect(errorSpy).toHaveBeenCalledWith(
      '[billing-reconciliation] job moved to dead letter',
      expect.objectContaining({ workspaceId, attempts: 6, correlationId: expect.any(String) })
    )

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
    errorSpy.mockRestore()
  })
})
