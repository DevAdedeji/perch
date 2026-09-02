import { randomUUID } from 'node:crypto'
import { and, billingReconciliationJobs, billingWebhookDeliveries, desc, eq, inArray, isNull, lt, ne, or, sql, users, workspaceInvoices, workspaceMembers, workspaceSubscriptions } from '@perch/db'
import type { BillingInterval, SubscriptionStatus } from '@perch/shared'
import { PERCH_PRO_PLAN, proPriceCents } from '@perch/shared'
import type { BachsCheckoutSession, BachsSubscription } from './bachs'
import {
  bachsConfigured,
  cancelBachsSubscription,
  createSubscriptionCheckout,
  ensurePerchProProduct,
  getBachsCheckoutSession,
  getBachsSubscription,
  isApprovedBachsCheckoutUrl,
  BACHS_MAX_GET_ATTEMPTS
} from './bachs'
import { explicitlyEnabled } from '../../config/launch'

export interface WorkspaceEntitlement {
  plan: 'free' | 'pro'
  isPro: boolean
  status: SubscriptionStatus | null
  interval: BillingInterval | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  providerSubscriptionConnected: boolean
  limits: { members: number | null, reminderMinutes: number }
  features: { customReminderDelay: boolean, businessHoursReminders: boolean, removeBranding: boolean }
}

const RECONCILIATION_LEASE_MS = 10 * 60_000
const RECONCILIATION_MAX_FAILURES = 6
const RECONCILIATION_SWEEP_LIMIT = 5
const RECONCILIATION_POLL_MS = 2 * 60_000
const RECONCILIATION_SUBSCRIPTION_MS = 6 * 60 * 60_000

type BillingReconciliationSource = 'manual' | 'sweep' | 'webhook'

export function billingCheckoutEnabled() {
  const config = useRuntimeConfig()
  return config.billingCheckoutEnabled === true
    || explicitlyEnabled(process.env.PERCH_BILLING_CHECKOUT_ENABLED)
}

export function subscriptionHasPaidAccess(
  row: Pick<typeof workspaceSubscriptions.$inferSelect, 'status' | 'currentPeriodEnd'> | undefined,
  hasConfirmedInvoice: boolean,
  now = new Date()
) {
  if (!row || !hasConfirmedInvoice) return false
  if (!['trialing', 'active', 'past_due', 'canceled'].includes(row.status)) return false
  return Boolean(row.currentPeriodEnd && row.currentPeriodEnd.getTime() > now.getTime())
}

export async function workspaceEntitlement(workspaceId: string): Promise<WorkspaceEntitlement> {
  const row = await useDb().query.workspaceSubscriptions.findFirst({ where: eq(workspaceSubscriptions.workspaceId, workspaceId) })
  const invoice = row?.lastInvoiceReference
    ? await useDb().query.workspaceInvoices.findFirst({ where: and(
        eq(workspaceInvoices.workspaceId, workspaceId),
        eq(workspaceInvoices.reference, row.lastInvoiceReference)
      ) })
    : undefined
  const isPro = subscriptionHasPaidAccess(row, invoice?.status === 'paid')
  return {
    plan: isPro ? 'pro' : 'free',
    isPro,
    status: row?.status ?? null,
    interval: row?.interval ?? null,
    currentPeriodEnd: row?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
    providerSubscriptionConnected: Boolean(row?.bachsSubscriptionId),
    limits: {
      members: isPro ? null : PERCH_PRO_PLAN.freeMemberLimit,
      reminderMinutes: isPro ? 5 : PERCH_PRO_PLAN.freeReminderMinutes
    },
    features: {
      customReminderDelay: isPro,
      businessHoursReminders: isPro,
      removeBranding: isPro
    }
  }
}

function periodEnd(from: Date, interval: BillingInterval) {
  const end = new Date(from)
  if (interval === 'yearly') end.setUTCFullYear(end.getUTCFullYear() + 1)
  else end.setUTCMonth(end.getUTCMonth() + 1)
  return end
}

function assertPublicReturnUrl(origin: string) {
  const host = new URL(origin).hostname
  if (['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Bachs cannot return to localhost. Use a public HTTPS tunnel or staging to test checkout.'
    })
  }
}

export function providerAmountCents(amount: string | null | undefined): number | null {
  if (!amount || !/^\d+(?:\.\d+)?$/.test(amount)) return null
  const [whole, fraction = ''] = amount.split('.')
  if (fraction.length > 2) return null
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

export function checkoutPaymentState(checkout: BachsCheckoutSession): 'paid' | 'pending' | 'failed' {
  const paymentStatus = checkout.charge?.status ?? checkout.payment_status
  if (checkout.charge && ['succeeded', 'accepted'].includes(checkout.charge.status)) return 'paid'
  if (checkout.status === 'completed' && paymentStatus === 'succeeded') return 'paid'
  if (checkout.status === 'expired'
    || checkout.status === 'cancelled'
    || ['failed', 'canceled', 'cancelled', 'expired', 'refunded', 'partially_refunded', 'underpaid', 'overpaid'].includes(paymentStatus ?? '')) return 'failed'
  return 'pending'
}

export function invoiceMatchesPerchPlan(
  invoice: Pick<typeof workspaceInvoices.$inferSelect, 'interval' | 'amountCents' | 'currency'>
) {
  return invoice.amountCents === proPriceCents(invoice.interval)
    && invoice.currency.toUpperCase() === PERCH_PRO_PLAN.currency
}

export function checkoutMatchesInvoice(
  checkout: BachsCheckoutSession,
  invoice: Pick<typeof workspaceInvoices.$inferSelect, 'reference' | 'bachsCheckoutId' | 'interval' | 'amountCents' | 'currency'>
) {
  if (!invoiceMatchesPerchPlan(invoice)) return false
  if (!invoice.bachsCheckoutId || checkout.checkout_id !== invoice.bachsCheckoutId) return false
  if (checkout.reference !== invoice.reference) return false
  if (checkout.currency.toUpperCase() !== invoice.currency.toUpperCase()) return false
  if (providerAmountCents(checkout.amount) !== invoice.amountCents) return false
  if (checkout.charge) {
    if (checkout.charge.currency.toUpperCase() !== invoice.currency.toUpperCase()) return false
    if (providerAmountCents(checkout.charge.amount) !== invoice.amountCents) return false
    if (checkout.charge.amount_paid && providerAmountCents(checkout.charge.amount_paid) !== invoice.amountCents) return false
  }
  return true
}

export function providerPaidThroughEnd(subscription: BachsSubscription): Date | null {
  const value = subscription.status === 'trialing'
    ? subscription.trial_end
    : subscription.current_period_end
  return value ? new Date(value) : null
}

export function providerSubscriptionIdentity(subscription: BachsSubscription) {
  const workspaceId = subscription.metadata?.workspaceId
  const invoiceReference = subscription.metadata?.invoiceReference
  const metadataInterval = subscription.metadata?.interval
  if (!workspaceId || !invoiceReference || subscription.metadata?.perchPlan !== 'workspace_pro') return null
  const productPlan = subscription.product?.metadata?.perch_plan
  const interval: BillingInterval | null = productPlan === 'workspace_pro_yearly'
    ? 'yearly'
    : productPlan === 'workspace_pro_monthly'
      ? 'monthly'
      : null
  if (!interval || metadataInterval !== interval) return null
  return { workspaceId, invoiceReference, interval }
}

export async function startWorkspaceCheckout(input: {
  workspaceId: string
  interval: BillingInterval
  requestId: string
  customer: { email: string, name: string }
  origin: string
}) {
  assertPublicReturnUrl(input.origin)
  const entitlement = await workspaceEntitlement(input.workspaceId)
  if (entitlement.isPro) throw createError({ statusCode: 409, statusMessage: 'Perch Pro is already active for this workspace.' })

  const db = useDb()
  const reference = `perch-workspace-${input.workspaceId}-${input.requestId}`
  const existing = await db.query.workspaceInvoices.findFirst({ where: eq(workspaceInvoices.reference, reference) })
  if (existing?.status === 'pending' && existing.checkoutUrl && existing.bachsCheckoutId) {
    const canonicalCheckout = await getBachsCheckoutSession(existing.bachsCheckoutId)
    if (isApprovedBachsCheckoutUrl(existing.checkoutUrl)
      && checkoutMatchesInvoice(canonicalCheckout, existing)
      && checkoutPaymentState(canonicalCheckout) === 'pending') {
      return { checkoutUrl: existing.checkoutUrl, reference }
    }
    throw createError({ statusCode: 409, statusMessage: 'That checkout attempt can no longer be resumed.' })
  }
  if (existing) throw createError({ statusCode: 409, statusMessage: 'That checkout attempt has already finished.' })

  const start = new Date()
  const end = periodEnd(start, input.interval)
  const [invoice] = await db.insert(workspaceInvoices).values({
    workspaceId: input.workspaceId,
    reference,
    interval: input.interval,
    amountCents: proPriceCents(input.interval),
    periodStart: start,
    periodEnd: end
  }).returning()

  try {
    const productId = await ensurePerchProProduct(input.interval)
    const checkout = await createSubscriptionCheckout({
      productId,
      reference,
      customer: input.customer,
      successUrl: `${input.origin}/billing?paid=1`,
      cancelUrl: `${input.origin}/billing`,
      metadata: {
        workspaceId: input.workspaceId,
        interval: input.interval,
        perchPlan: 'workspace_pro',
        invoiceReference: reference
      }
    })
    if (!isApprovedBachsCheckoutUrl(checkout.checkout_url)) {
      throw createError({ statusCode: 502, statusMessage: 'Bachs did not return a trusted checkout URL.' })
    }
    const canonicalCheckout = await getBachsCheckoutSession(checkout.checkout_id)
    const expectedInvoice = { ...invoice!, bachsCheckoutId: checkout.checkout_id }
    if (!checkoutMatchesInvoice(canonicalCheckout, expectedInvoice)) {
      throw createError({ statusCode: 502, statusMessage: 'Bachs checkout did not match the expected plan.' })
    }
    await db.transaction(async (tx) => {
      await tx.update(workspaceInvoices).set({
        bachsCheckoutId: checkout.checkout_id,
        checkoutUrl: checkout.checkout_url,
        updatedAt: sql`now()`
      }).where(eq(workspaceInvoices.id, invoice!.id))
      await tx.insert(billingReconciliationJobs).values({ workspaceId: input.workspaceId })
        .onConflictDoUpdate({
          target: billingReconciliationJobs.workspaceId,
          set: {
            status: sql`case when ${billingReconciliationJobs.status} = 'processing' then ${billingReconciliationJobs.status} else 'pending'::billing_reconciliation_status end`,
            attempts: sql`case when ${billingReconciliationJobs.status} = 'processing' then ${billingReconciliationJobs.attempts} else 0 end`,
            requestedAt: sql`case when ${billingReconciliationJobs.status} = 'processing' then now() else null end`,
            nextAttemptAt: sql`case when ${billingReconciliationJobs.status} = 'processing' then ${billingReconciliationJobs.nextAttemptAt} else now() end`,
            lastError: sql`case when ${billingReconciliationJobs.status} = 'processing' then ${billingReconciliationJobs.lastError} else null end`,
            updatedAt: sql`now()`
          }
        })
    })
    return { checkoutUrl: checkout.checkout_url, reference }
  } catch (error) {
    await db.update(workspaceInvoices).set({
      status: 'failed',
      lastError: String((error as { statusMessage?: string })?.statusMessage ?? error).slice(0, 1000),
      updatedAt: sql`now()`
    }).where(eq(workspaceInvoices.id, invoice!.id))
    throw error
  }
}

export async function cancelWorkspacePlan(workspaceId: string) {
  const now = new Date()
  const claim = await claimBillingReconciliation(workspaceId, 'manual', now)
  if (!claim) {
    await enqueueBillingReconciliation(workspaceId, now)
    throw createError({ statusCode: 503, statusMessage: 'Billing status is already being checked. Please retry shortly.' })
  }
  const db = useDb()
  try {
    const [row, entitlement] = await Promise.all([
      db.query.workspaceSubscriptions.findFirst({ where: eq(workspaceSubscriptions.workspaceId, workspaceId) }),
      workspaceEntitlement(workspaceId)
    ])
    if (!row || !entitlement.isPro) throw createError({ statusCode: 409, statusMessage: 'Perch Pro is not active.' })
    if (!row.bachsSubscriptionId) {
      throw createError({ statusCode: 409, statusMessage: 'The billing provider subscription could not be confirmed.' })
    }
    const subscription = await cancelBachsSubscription(row.bachsSubscriptionId)
    if (subscription.id !== row.bachsSubscriptionId) {
      throw createError({ statusCode: 502, statusMessage: 'Bachs returned a different subscription.' })
    }
    if (!subscription.cancel_at_period_end && subscription.status !== 'canceled') {
      throw createError({ statusCode: 502, statusMessage: 'Bachs did not confirm the cancellation.' })
    }
    const end = subscription.current_period_end ? new Date(subscription.current_period_end) : row.currentPeriodEnd
    await db.update(workspaceSubscriptions).set({
      status: subscription.status,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: end,
      updatedAt: sql`now()`
    }).where(eq(workspaceSubscriptions.workspaceId, workspaceId))
    await finishBillingReconciliation(workspaceId, claim.token, nextSuccessfulBillingCheck({
      pendingCheckout: false,
      subscription,
      now
    }), new Date())
    return { cancelAtPeriodEnd: true, currentPeriodEnd: end?.toISOString() ?? null }
  } catch (error) {
    await failBillingReconciliation(workspaceId, claim.token, error, now)
    throw error
  }
}

export async function billingOverview(workspaceId: string) {
  const db = useDb()
  const [entitlement, invoices, reconciliation, subscription] = await Promise.all([
    workspaceEntitlement(workspaceId),
    db.select({
      id: workspaceInvoices.id,
      reference: workspaceInvoices.reference,
      status: workspaceInvoices.status,
      interval: workspaceInvoices.interval,
      amountCents: workspaceInvoices.amountCents,
      currency: workspaceInvoices.currency,
      paidAt: workspaceInvoices.paidAt,
      createdAt: workspaceInvoices.createdAt
    }).from(workspaceInvoices).where(eq(workspaceInvoices.workspaceId, workspaceId))
      .orderBy(desc(workspaceInvoices.createdAt)).limit(24),
    db.query.billingReconciliationJobs.findFirst({ where: eq(billingReconciliationJobs.workspaceId, workspaceId) }),
    db.query.workspaceSubscriptions.findFirst({ where: eq(workspaceSubscriptions.workspaceId, workspaceId) })
  ])
  return {
    entitlement,
    checkoutEnabled: billingCheckoutEnabled() && bachsConfigured(),
    providerConfigured: bachsConfigured(),
    hasBillingHistory: invoices.length > 0 || entitlement.providerSubscriptionConnected,
    needsProviderSubscription: invoices[0]?.status === 'paid' && (
      !subscription?.bachsSubscriptionId || subscription.lastInvoiceReference !== invoices[0].reference
    ),
    reconciliation: reconciliation
      ? {
          status: reconciliation.status,
          lastCheckedAt: reconciliation.lastCheckedAt?.toISOString() ?? null,
          nextAttemptAt: reconciliation.nextAttemptAt?.toISOString() ?? null,
          needsAttention: reconciliation.status === 'failed'
        }
      : null,
    invoices: invoices.map(row => ({
      ...row,
      paidAt: row.paidAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString()
    }))
  }
}

export async function applyWorkspaceSubscriptionState(subscription: BachsSubscription) {
  const identity = providerSubscriptionIdentity(subscription)
  if (!identity) {
    return { applied: false, reason: 'not-perch-pro' as const }
  }
  const { workspaceId, invoiceReference, interval } = identity
  const db = useDb()
  const [invoice, existingSubscription] = await Promise.all([
    db.query.workspaceInvoices.findFirst({ where: and(
      eq(workspaceInvoices.workspaceId, workspaceId),
      eq(workspaceInvoices.reference, invoiceReference),
      eq(workspaceInvoices.interval, interval)
    ) }),
    db.query.workspaceSubscriptions.findFirst({ where: eq(workspaceSubscriptions.workspaceId, workspaceId) })
  ])
  if (!invoice?.bachsCheckoutId || !invoiceMatchesPerchPlan(invoice)) {
    return { applied: false, reason: 'unknown-invoice' as const }
  }
  const existingInvoice = existingSubscription?.lastInvoiceReference
    ? await db.query.workspaceInvoices.findFirst({ where: and(
        eq(workspaceInvoices.workspaceId, workspaceId),
        eq(workspaceInvoices.reference, existingSubscription.lastInvoiceReference)
      ) })
    : undefined
  const replacingLineage = Boolean(existingSubscription && (
    (existingSubscription.lastInvoiceReference && existingSubscription.lastInvoiceReference !== invoiceReference)
    || (existingSubscription.bachsSubscriptionId && existingSubscription.bachsSubscriptionId !== subscription.id)
  ))
  if (replacingLineage) {
    const existingStillPaid = subscriptionHasPaidAccess(existingSubscription, existingInvoice?.status === 'paid')
    const incomingIsNewer = Boolean(existingInvoice && invoice.createdAt > existingInvoice.createdAt)
    if (existingStillPaid || !incomingIsNewer) {
      return { applied: false, reason: 'stale-invoice' as const }
    }
  }
  const end = providerPaidThroughEnd(subscription)
  await db.insert(workspaceSubscriptions).values({
    workspaceId,
    status: subscription.status,
    interval,
    currentPeriodEnd: end,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    bachsSubscriptionId: subscription.id,
    lastInvoiceReference: invoiceReference
  }).onConflictDoUpdate({
    target: workspaceSubscriptions.workspaceId,
    set: {
      status: subscription.status,
      interval,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      bachsSubscriptionId: subscription.id,
      lastInvoiceReference: invoiceReference,
      updatedAt: sql`now()`
    }
  })
  return { applied: true, workspaceId }
}

async function markWorkspaceInvoicePaid(reference: string, chargeId?: string | null) {
  return useDb().transaction(async (tx) => {
    const [invoice] = await tx.select().from(workspaceInvoices).where(eq(workspaceInvoices.reference, reference)).limit(1).for('update')
    if (!invoice) return { applied: false, reason: 'unknown-reference' as const }
    if (invoice.status === 'paid') return { applied: false, reason: 'already-paid' as const, workspaceId: invoice.workspaceId }
    await tx.update(workspaceInvoices).set({
      status: 'paid', paidAt: sql`now()`, bachsChargeId: chargeId ?? invoice.bachsChargeId, lastError: null, updatedAt: sql`now()`
    }).where(eq(workspaceInvoices.id, invoice.id))
    return { applied: true, reason: 'paid' as const, workspaceId: invoice.workspaceId }
  })
}

async function markWorkspaceInvoiceProviderFailed(reference: string, reason: string) {
  return useDb().transaction(async (tx) => {
    const [invoice] = await tx.select().from(workspaceInvoices).where(eq(workspaceInvoices.reference, reference)).limit(1).for('update')
    if (!invoice) return { applied: false, reason: 'unknown-reference' as const }
    if (invoice.status === 'failed' && invoice.lastError === reason) {
      return { applied: false, reason: 'already-failed' as const, workspaceId: invoice.workspaceId }
    }
    await tx.update(workspaceInvoices).set({
      status: 'failed', paidAt: null, lastError: reason.slice(0, 1000), updatedAt: sql`now()`
    }).where(eq(workspaceInvoices.id, invoice.id))
    return { applied: true, reason: 'provider-failed' as const, workspaceId: invoice.workspaceId }
  })
}

async function syncWorkspaceInvoiceFromCanonicalCheckout(
  invoice: typeof workspaceInvoices.$inferSelect,
  checkout: BachsCheckoutSession
) {
  if (!checkoutMatchesInvoice(checkout, invoice)) {
    throw createError({ statusCode: 502, statusMessage: 'Bachs checkout did not match the local invoice.' })
  }
  const state = checkoutPaymentState(checkout)
  if (state === 'failed') {
    return markWorkspaceInvoiceProviderFailed(invoice.reference, `Bachs checkout is ${checkout.charge?.status ?? checkout.status}.`)
  }
  if (state === 'pending') return { applied: false, reason: 'provider-pending' as const, workspaceId: invoice.workspaceId }
  return markWorkspaceInvoicePaid(invoice.reference, checkout.charge?.payment_id)
}

async function enqueueBillingReconciliation(workspaceId: string, now = new Date()) {
  const nowIso = now.toISOString()
  await useDb().insert(billingReconciliationJobs).values({ workspaceId, nextAttemptAt: now })
    .onConflictDoUpdate({
      target: billingReconciliationJobs.workspaceId,
      set: {
        status: sql`case when ${billingReconciliationJobs.status} = 'processing' then ${billingReconciliationJobs.status} else 'pending'::billing_reconciliation_status end`,
        requestedAt: sql`case when ${billingReconciliationJobs.status} = 'processing' then ${nowIso}::timestamptz else null end`,
        nextAttemptAt: sql`case when ${billingReconciliationJobs.status} = 'processing' then ${billingReconciliationJobs.nextAttemptAt} else ${nowIso}::timestamptz end`,
        updatedAt: sql`now()`
      }
    })
}

async function claimBillingReconciliation(
  workspaceId: string,
  source: BillingReconciliationSource,
  now: Date,
  notCheckedAfter?: Date
) {
  await useDb().insert(billingReconciliationJobs).values({ workspaceId, nextAttemptAt: now }).onConflictDoNothing()
  const stale = new Date(now.getTime() - RECONCILIATION_LEASE_MS)
  const nowIso = now.toISOString()
  const sourceCondition = source === 'sweep'
    ? or(
        and(
          inArray(billingReconciliationJobs.status, ['pending', 'retrying']),
          sql`${billingReconciliationJobs.nextAttemptAt} <= ${nowIso}::timestamptz`
        ),
        and(
          eq(billingReconciliationJobs.status, 'processing'),
          or(isNull(billingReconciliationJobs.claimedAt), lt(billingReconciliationJobs.claimedAt, stale))
        )
      )
    : undefined
  const token = randomUUID()
  // A subscription webhook needs one canonical read to discover its workspace.
  // If another claim completed while that read was in flight, requeue instead
  // of letting the older response overwrite the newer local snapshot.
  const snapshotCondition = notCheckedAfter
    ? or(
        isNull(billingReconciliationJobs.lastCheckedAt),
        lt(billingReconciliationJobs.lastCheckedAt, notCheckedAfter)
      )
    : undefined
  const [job] = await useDb().update(billingReconciliationJobs).set({
    status: 'processing',
    claimToken: token,
    claimedAt: now,
    requestedAt: null,
    updatedAt: sql`now()`
  }).where(and(
    eq(billingReconciliationJobs.workspaceId, workspaceId),
    or(
      ne(billingReconciliationJobs.status, 'processing'),
      isNull(billingReconciliationJobs.claimedAt),
      lt(billingReconciliationJobs.claimedAt, stale)
    ),
    sourceCondition,
    snapshotCondition
  )).returning()
  return job ? { token, job } : null
}

function billingReconciliationRetryAt(attempts: number, now: Date) {
  const delays = [5, 15, 60, 180, 360, 360]
  return new Date(now.getTime() + delays[Math.min(attempts - 1, delays.length - 1)]! * 60_000)
}

function nextSuccessfulBillingCheck(input: {
  pendingCheckout: boolean
  subscription: BachsSubscription | null
  now: Date
}) {
  if (input.pendingCheckout) return new Date(input.now.getTime() + RECONCILIATION_POLL_MS)
  if (!input.subscription) return null
  const end = providerPaidThroughEnd(input.subscription)
  if (input.subscription.status === 'canceled' && (!end || end <= input.now)) return null
  const normal = new Date(input.now.getTime() + RECONCILIATION_SUBSCRIPTION_MS)
  if (!end || end <= input.now) return normal
  const boundary = new Date(Math.max(input.now.getTime() + RECONCILIATION_POLL_MS, end.getTime() - 30 * 60_000))
  return boundary < normal ? boundary : normal
}

async function finishBillingReconciliation(
  workspaceId: string,
  token: string,
  nextAttemptAt: Date | null,
  now: Date
) {
  const nowIso = now.toISOString()
  const nextAttemptIso = nextAttemptAt?.toISOString() ?? null
  const [updated] = await useDb().update(billingReconciliationJobs).set({
    status: sql`case when ${billingReconciliationJobs.requestedAt} is not null then 'pending'::billing_reconciliation_status when ${nextAttemptIso}::timestamptz is not null then 'pending'::billing_reconciliation_status else 'idle'::billing_reconciliation_status end`,
    attempts: 0,
    claimToken: null,
    claimedAt: null,
    requestedAt: null,
    nextAttemptAt: sql`case when ${billingReconciliationJobs.requestedAt} is not null then ${nowIso}::timestamptz else ${nextAttemptIso}::timestamptz end`,
    lastCheckedAt: now,
    lastError: null,
    updatedAt: sql`now()`
  }).where(and(
    eq(billingReconciliationJobs.workspaceId, workspaceId),
    eq(billingReconciliationJobs.claimToken, token)
  )).returning({ workspaceId: billingReconciliationJobs.workspaceId })
  return Boolean(updated)
}

async function failBillingReconciliation(workspaceId: string, token: string, error: unknown, now: Date) {
  const current = await useDb().query.billingReconciliationJobs.findFirst({
    where: and(
      eq(billingReconciliationJobs.workspaceId, workspaceId),
      eq(billingReconciliationJobs.claimToken, token)
    )
  })
  if (!current) return
  const attempts = Math.min(current.attempts + 1, RECONCILIATION_MAX_FAILURES)
  const terminal = attempts >= RECONCILIATION_MAX_FAILURES && !current.requestedAt
  const nowIso = now.toISOString()
  const retryIso = terminal ? null : billingReconciliationRetryAt(attempts, now).toISOString()
  await useDb().update(billingReconciliationJobs).set({
    status: sql`case when ${billingReconciliationJobs.requestedAt} is not null then 'retrying'::billing_reconciliation_status else ${terminal ? 'failed' : 'retrying'}::billing_reconciliation_status end`,
    attempts,
    claimToken: null,
    claimedAt: null,
    requestedAt: null,
    nextAttemptAt: sql`case when ${billingReconciliationJobs.requestedAt} is not null then ${nowIso}::timestamptz else ${retryIso}::timestamptz end`,
    lastError: String((error as { statusMessage?: string })?.statusMessage ?? (error as Error)?.message ?? error).slice(0, 1000),
    updatedAt: sql`now()`
  }).where(and(
    eq(billingReconciliationJobs.workspaceId, workspaceId),
    eq(billingReconciliationJobs.claimToken, token)
  ))
}

interface ReconcileWorkspaceBillingOptions {
  source?: BillingReconciliationSource
  invoiceReference?: string | null
  checkoutId?: string | null
  subscriptionId?: string | null
  subscriptionSnapshot?: BachsSubscription | null
  snapshotStartedAt?: Date
  now?: Date
}

async function reconcileWorkspaceBillingUnderClaim(workspaceId: string, options: ReconcileWorkspaceBillingOptions) {
  const db = useDb()
  const subscriptionRow = await db.query.workspaceSubscriptions.findFirst({
    where: eq(workspaceSubscriptions.workspaceId, workspaceId)
  })
  const subscriptionId = options.subscriptionId ?? subscriptionRow?.bachsSubscriptionId ?? null
  const canonicalSubscription = options.subscriptionSnapshot
    ?? (subscriptionId ? await getBachsSubscription(subscriptionId) : null)
  const subscriptionIdentity = canonicalSubscription ? providerSubscriptionIdentity(canonicalSubscription) : null
  if (canonicalSubscription && canonicalSubscription.id !== subscriptionId) {
    throw createError({ statusCode: 502, statusMessage: 'Bachs returned a different subscription.' })
  }
  if (canonicalSubscription && (!subscriptionIdentity || subscriptionIdentity.workspaceId !== workspaceId)) {
    throw createError({ statusCode: 502, statusMessage: 'Bachs subscription did not match this workspace.' })
  }

  // There is no documented Bachs lookup from an invoice to a subscription.
  // Reconciliation therefore reads only the current checkout and the one
  // already-known subscription: two provider resources at most.
  const latestPendingInvoice = !options.invoiceReference && !options.checkoutId && !options.subscriptionSnapshot
    ? await db.query.workspaceInvoices.findFirst({ where: and(
        eq(workspaceInvoices.workspaceId, workspaceId),
        eq(workspaceInvoices.status, 'pending'),
        sql`${workspaceInvoices.bachsCheckoutId} is not null`
      ), orderBy: desc(workspaceInvoices.createdAt) })
    : undefined
  const targetReference = options.invoiceReference
    ?? (options.subscriptionSnapshot ? subscriptionIdentity?.invoiceReference : null)
    ?? latestPendingInvoice?.reference
    ?? subscriptionRow?.lastInvoiceReference
    ?? subscriptionIdentity?.invoiceReference
    ?? null
  let invoice = options.checkoutId
    ? await db.query.workspaceInvoices.findFirst({ where: and(
        eq(workspaceInvoices.workspaceId, workspaceId),
        eq(workspaceInvoices.bachsCheckoutId, options.checkoutId)
      ) })
    : targetReference
      ? await db.query.workspaceInvoices.findFirst({ where: and(
          eq(workspaceInvoices.workspaceId, workspaceId),
          eq(workspaceInvoices.reference, targetReference)
        ) })
      : undefined
  if (!invoice) {
    invoice = await db.query.workspaceInvoices.findFirst({ where: and(
      eq(workspaceInvoices.workspaceId, workspaceId),
      eq(workspaceInvoices.status, 'pending'),
      sql`${workspaceInvoices.bachsCheckoutId} is not null`
    ), orderBy: desc(workspaceInvoices.createdAt) })
  }
  const canonicalCheckout = invoice?.bachsCheckoutId
    ? await getBachsCheckoutSession(invoice.bachsCheckoutId)
    : null

  if (canonicalCheckout && !checkoutMatchesInvoice(canonicalCheckout, invoice!)) {
    throw createError({ statusCode: 502, statusMessage: 'Bachs checkout did not match the local invoice.' })
  }
  if (subscriptionIdentity) {
    const subscriptionInvoice = invoice?.reference === subscriptionIdentity.invoiceReference
      ? invoice
      : await db.query.workspaceInvoices.findFirst({ where: and(
          eq(workspaceInvoices.workspaceId, workspaceId),
          eq(workspaceInvoices.reference, subscriptionIdentity.invoiceReference),
          eq(workspaceInvoices.interval, subscriptionIdentity.interval)
        ) })
    if (!subscriptionInvoice?.bachsCheckoutId || !invoiceMatchesPerchPlan(subscriptionInvoice)) {
      throw createError({ statusCode: 502, statusMessage: 'Bachs subscription did not match a valid Perch invoice.' })
    }
  }

  const invoiceOutcome = canonicalCheckout
    ? await syncWorkspaceInvoiceFromCanonicalCheckout(invoice!, canonicalCheckout)
    : { applied: false, reason: 'unknown-checkout' as const, workspaceId }
  let subscriptionUpdated = false
  let subscriptionIgnored = false
  if (canonicalSubscription) {
    const applied = await applyWorkspaceSubscriptionState(canonicalSubscription)
    if (applied.applied) subscriptionUpdated = true
    else if (applied.reason === 'stale-invoice') subscriptionIgnored = true
    else throw createError({ statusCode: 502, statusMessage: 'Bachs subscription could not be safely reconciled.' })
  }
  return {
    invoiceOutcome,
    invoicesChecked: canonicalCheckout ? 1 : 0,
    invoicesChanged: invoiceOutcome.applied ? 1 : 0,
    subscriptionChecked: Boolean(canonicalSubscription),
    subscriptionUpdated,
    subscriptionIgnored,
    pendingCheckout: canonicalCheckout ? checkoutPaymentState(canonicalCheckout) === 'pending' : false,
    canonicalSubscription,
    providerResourcesChecked: (canonicalCheckout ? 1 : 0) + (canonicalSubscription ? 1 : 0)
  }
}

export async function reconcileWorkspaceBilling(workspaceId: string, options: ReconcileWorkspaceBillingOptions = {}) {
  const source = options.source ?? 'manual'
  const now = options.now ?? new Date()
  const claim = await claimBillingReconciliation(workspaceId, source, now, options.snapshotStartedAt)
  if (!claim) {
    if (source === 'sweep') return null
    await enqueueBillingReconciliation(workspaceId, now)
    throw createError({ statusCode: 503, statusMessage: 'Billing status is already being checked. Please retry shortly.' })
  }
  try {
    const result = await reconcileWorkspaceBillingUnderClaim(workspaceId, options)
    const nextAttemptAt = nextSuccessfulBillingCheck({
      pendingCheckout: result.pendingCheckout,
      subscription: result.canonicalSubscription,
      now
    })
    await finishBillingReconciliation(workspaceId, claim.token, nextAttemptAt, new Date())
    const overview = await billingOverview(workspaceId)
    return {
      checkedAt: now.toISOString(),
      invoicesChecked: result.invoicesChecked,
      invoicesChanged: result.invoicesChanged,
      subscriptionChecked: result.subscriptionChecked,
      subscriptionUpdated: result.subscriptionUpdated,
      subscriptionIgnored: result.subscriptionIgnored,
      providerResourcesChecked: result.providerResourcesChecked,
      providerRequestCap: result.providerResourcesChecked * BACHS_MAX_GET_ATTEMPTS,
      nextCheckAt: nextAttemptAt?.toISOString() ?? null,
      awaitingSubscription: overview.needsProviderSubscription,
      invoiceOutcome: result.invoiceOutcome,
      overview
    }
  } catch (error) {
    await failBillingReconciliation(workspaceId, claim.token, error, now)
    throw error
  }
}

export async function confirmWorkspaceInvoiceFromCheckout(input: { checkoutId?: string | null, reference?: string | null }) {
  if (!input.checkoutId && !input.reference) return { applied: false, reason: 'missing-checkout' as const }
  const invoice = await useDb().query.workspaceInvoices.findFirst({ where: input.checkoutId
    ? eq(workspaceInvoices.bachsCheckoutId, input.checkoutId)
    : eq(workspaceInvoices.reference, input.reference!) })
  if (!invoice?.bachsCheckoutId) return { applied: false, reason: 'unknown-checkout' as const }
  const result = await reconcileWorkspaceBilling(invoice.workspaceId, {
    source: 'webhook',
    checkoutId: invoice.bachsCheckoutId
  })
  return result!.invoiceOutcome
}

export async function reconcileWorkspaceSubscriptionEvent(subscriptionId: string) {
  const snapshotStartedAt = new Date()
  const identitySnapshot = await getBachsSubscription(subscriptionId)
  if (identitySnapshot.id !== subscriptionId) {
    throw createError({ statusCode: 502, statusMessage: 'Bachs returned a different subscription.' })
  }
  const identity = providerSubscriptionIdentity(identitySnapshot)
  if (!identity) {
    return { applied: false, reason: 'not-perch-pro' as const }
  }
  const result = await reconcileWorkspaceBilling(identity.workspaceId, {
    source: 'webhook',
    subscriptionId,
    subscriptionSnapshot: identitySnapshot,
    snapshotStartedAt
  })
  return result!.subscriptionIgnored
    ? { applied: false, reason: 'stale-invoice' as const, workspaceId: identity.workspaceId }
    : { applied: result!.subscriptionUpdated, workspaceId: identity.workspaceId }
}

export async function runBillingReconciliationSweep(options: { now?: Date, limit?: number } = {}) {
  if (!bachsConfigured()) return { checked: 0, failed: 0, skipped: true }
  const now = options.now ?? new Date()
  const nowIso = now.toISOString()
  const stale = new Date(now.getTime() - RECONCILIATION_LEASE_MS)
  const limit = Math.max(1, Math.min(options.limit ?? RECONCILIATION_SWEEP_LIMIT, RECONCILIATION_SWEEP_LIMIT))
  const jobs = await useDb().select({ workspaceId: billingReconciliationJobs.workspaceId })
    .from(billingReconciliationJobs)
    .where(or(
      and(
        inArray(billingReconciliationJobs.status, ['pending', 'retrying']),
        sql`${billingReconciliationJobs.nextAttemptAt} <= ${nowIso}::timestamptz`
      ),
      and(
        eq(billingReconciliationJobs.status, 'processing'),
        or(isNull(billingReconciliationJobs.claimedAt), lt(billingReconciliationJobs.claimedAt, stale))
      )
    ))
    .orderBy(billingReconciliationJobs.nextAttemptAt)
    .limit(limit)
  let checked = 0
  let failed = 0
  for (const job of jobs) {
    try {
      const result = await reconcileWorkspaceBilling(job.workspaceId, { source: 'sweep', now })
      if (result) checked++
    } catch {
      failed++
    }
  }
  return { checked, failed, skipped: false }
}

export async function claimBillingWebhook(providerEventId: string, eventType: string) {
  const db = useDb()
  const [created] = await db.insert(billingWebhookDeliveries).values({ providerEventId, eventType }).onConflictDoNothing().returning()
  if (created) return { delivery: created, shouldProcess: true }
  const stale = new Date(Date.now() - 5 * 60_000)
  const [reclaimed] = await db.update(billingWebhookDeliveries).set({
    status: 'processing', attempts: sql`${billingWebhookDeliveries.attempts} + 1`, lastError: null, updatedAt: sql`now()`
  }).where(and(
    eq(billingWebhookDeliveries.providerEventId, providerEventId),
    or(eq(billingWebhookDeliveries.status, 'failed'), and(eq(billingWebhookDeliveries.status, 'processing'), lt(billingWebhookDeliveries.updatedAt, stale)))
  )).returning()
  const delivery = reclaimed ?? await db.query.billingWebhookDeliveries.findFirst({ where: eq(billingWebhookDeliveries.providerEventId, providerEventId) })
  return { delivery: delivery!, shouldProcess: Boolean(reclaimed) }
}

export async function finishBillingWebhook(id: string, status: 'completed' | 'ignored', error?: string) {
  await useDb().update(billingWebhookDeliveries).set({ status, lastError: error ?? null, updatedAt: sql`now()` })
    .where(eq(billingWebhookDeliveries.id, id))
}

export async function failBillingWebhook(id: string, error: unknown) {
  await useDb().update(billingWebhookDeliveries).set({
    status: 'failed', lastError: String((error as Error)?.message ?? error).slice(0, 1000), updatedAt: sql`now()`
  }).where(eq(billingWebhookDeliveries.id, id))
}

export async function workspaceBillingCustomer(workspaceId: string, userId: string) {
  const [row] = await useDb().select({ email: users.email, name: users.name })
    .from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))).limit(1)
  if (!row) throw createError({ statusCode: 403, statusMessage: 'Workspace membership required.' })
  return row
}
