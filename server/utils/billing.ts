import { randomUUID } from 'node:crypto'
import { and, billingFinancialConflicts, billingReconciliationJobs, billingWebhookDeliveries, desc, eq, inArray, isNull, lt, ne, or, sql, users, workspaceInvoices, workspaceMembers, workspaces, workspaceSubscriptions } from '@perch/db'
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
  productMatchesPerchPlan,
  BACHS_MAX_GET_ATTEMPTS
} from './bachs'
import { BACHS_RECURRING_RESPONSE_CONTRACT_VERIFIED, explicitlyEnabled } from '../../config/launch'

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
const CHECKOUT_CREATION_LEASE_MS = 2 * 60_000
const CHECKOUT_LATE_SUCCESS_WINDOW_MS = 24 * 60 * 60_000

type BillingReconciliationSource = 'manual' | 'sweep' | 'webhook'

export function billingCheckoutEnabled() {
  const config = useRuntimeConfig()
  return BACHS_RECURRING_RESPONSE_CONTRACT_VERIFIED
    && (config.billingCheckoutEnabled === true
      || explicitlyEnabled(process.env.PERCH_BILLING_CHECKOUT_ENABLED))
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
  const productPlan = subscription.product.metadata?.perch_plan
  const interval: BillingInterval | null = productPlan === 'workspace_pro_yearly'
    ? 'yearly'
    : productPlan === 'workspace_pro_monthly'
      ? 'monthly'
      : null
  if (!interval || metadataInterval !== interval || !productMatchesPerchPlan(subscription.product, interval)) return null
  return { workspaceId, invoiceReference, interval, productId: subscription.product.id }
}

export async function startWorkspaceCheckout(input: {
  workspaceId: string
  interval: BillingInterval
  requestId: string
  customer: { email: string, name: string }
  origin: string
}) {
  assertPublicReturnUrl(input.origin)
  const db = useDb()
  const reference = `perch-workspace-${input.workspaceId}-${input.requestId}`
  const claimToken = randomUUID()
  const now = new Date()
  const staleClaim = new Date(now.getTime() - CHECKOUT_CREATION_LEASE_MS)
  const reservation = await db.transaction(async (tx) => {
    const [workspace] = await tx.select({ id: workspaces.id }).from(workspaces)
      .where(eq(workspaces.id, input.workspaceId)).limit(1).for('update')
    if (!workspace) throw createError({ statusCode: 404, statusMessage: 'Workspace not found.' })

    const subscription = await tx.query.workspaceSubscriptions.findFirst({
      where: eq(workspaceSubscriptions.workspaceId, input.workspaceId)
    })
    const paidInvoice = subscription?.lastInvoiceReference
      ? await tx.query.workspaceInvoices.findFirst({ where: and(
          eq(workspaceInvoices.workspaceId, input.workspaceId),
          eq(workspaceInvoices.reference, subscription.lastInvoiceReference)
        ) })
      : undefined
    if (subscriptionHasPaidAccess(subscription, paidInvoice?.status === 'paid', now)) {
      throw createError({ statusCode: 409, statusMessage: 'Perch Pro is already active for this workspace.' })
    }

    const openInvoice = await tx.query.workspaceInvoices.findFirst({ where: and(
      eq(workspaceInvoices.workspaceId, input.workspaceId),
      isNull(workspaceInvoices.checkoutClosedAt)
    ), orderBy: desc(workspaceInvoices.createdAt) })
    if (openInvoice) {
      if (openInvoice.interval !== input.interval) {
        throw createError({
          statusCode: 409,
          statusMessage: `A ${openInvoice.interval} checkout is already open. Finish or close it before choosing ${input.interval}.`
        })
      }
      if (openInvoice.checkoutUrl && openInvoice.bachsCheckoutId) {
        return { invoice: openInvoice, ownsProviderCreation: false }
      }
      const claimExpired = !openInvoice.checkoutClaimedAt || openInvoice.checkoutClaimedAt < staleClaim
      if (!claimExpired) return { invoice: openInvoice, ownsProviderCreation: false }
      const [claimed] = await tx.update(workspaceInvoices).set({
        checkoutClaimToken: claimToken,
        checkoutClaimedAt: now,
        updatedAt: sql`now()`
      }).where(and(
        eq(workspaceInvoices.id, openInvoice.id),
        or(isNull(workspaceInvoices.checkoutClaimedAt), lt(workspaceInvoices.checkoutClaimedAt, staleClaim))
      )).returning()
      return { invoice: claimed ?? openInvoice, ownsProviderCreation: Boolean(claimed) }
    }

    const start = now
    const [invoice] = await tx.insert(workspaceInvoices).values({
      workspaceId: input.workspaceId,
      reference,
      interval: input.interval,
      amountCents: proPriceCents(input.interval),
      periodStart: start,
      periodEnd: periodEnd(start, input.interval),
      checkoutClaimToken: claimToken,
      checkoutClaimedAt: now,
      reconcileUntil: new Date(now.getTime() + CHECKOUT_LATE_SUCCESS_WINDOW_MS)
    }).returning()
    return { invoice: invoice!, ownsProviderCreation: true }
  })

  if (reservation.invoice.checkoutUrl && reservation.invoice.bachsCheckoutId) {
    const canonicalCheckout = await getBachsCheckoutSession(reservation.invoice.bachsCheckoutId)
    if (!isApprovedBachsCheckoutUrl(reservation.invoice.checkoutUrl)
      || !checkoutMatchesInvoice(canonicalCheckout, reservation.invoice)) {
      throw createError({ statusCode: 502, statusMessage: 'The existing Bachs checkout could not be verified.' })
    }
    const state = checkoutPaymentState(canonicalCheckout)
    if (state === 'pending') {
      return { checkoutUrl: reservation.invoice.checkoutUrl, reference: reservation.invoice.reference }
    }
    await enqueueBillingReconciliation(input.workspaceId, now)
    throw createError({
      statusCode: 409,
      statusMessage: state === 'paid'
        ? 'Payment was received and is waiting for subscription confirmation.'
        : 'The previous checkout is still inside its late-payment safety window. Check Bachs status before trying again.'
    })
  }
  if (!reservation.ownsProviderCreation) {
    throw createError({ statusCode: 409, statusMessage: 'A checkout is already being prepared for this workspace. Please retry shortly.' })
  }

  try {
    const productId = await ensurePerchProProduct(reservation.invoice.interval)
    const [renewedCheckoutClaim] = await db.update(workspaceInvoices).set({
      bachsProductId: productId,
      checkoutClaimedAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(and(
      eq(workspaceInvoices.id, reservation.invoice.id),
      eq(workspaceInvoices.checkoutClaimToken, claimToken)
    )).returning({ id: workspaceInvoices.id })
    if (!renewedCheckoutClaim) {
      throw createError({ statusCode: 409, statusMessage: 'A newer checkout request replaced this attempt.' })
    }
    const checkout = await createSubscriptionCheckout({
      productId,
      reference: reservation.invoice.reference,
      customer: input.customer,
      successUrl: `${input.origin}/billing?paid=1`,
      cancelUrl: `${input.origin}/billing`,
      metadata: {
        workspaceId: input.workspaceId,
        interval: reservation.invoice.interval,
        perchPlan: 'workspace_pro',
        invoiceReference: reservation.invoice.reference
      }
    })
    if (!isApprovedBachsCheckoutUrl(checkout.checkout_url)) {
      throw createError({ statusCode: 502, statusMessage: 'Bachs did not return a trusted checkout URL.' })
    }
    const canonicalCheckout = await getBachsCheckoutSession(checkout.checkout_id)
    const expectedInvoice = { ...reservation.invoice, bachsCheckoutId: checkout.checkout_id, bachsProductId: productId }
    if (!checkoutMatchesInvoice(canonicalCheckout, expectedInvoice)) {
      throw createError({ statusCode: 502, statusMessage: 'Bachs checkout did not match the expected plan.' })
    }
    await db.transaction(async (tx) => {
      const [updatedInvoice] = await tx.update(workspaceInvoices).set({
        bachsCheckoutId: checkout.checkout_id,
        checkoutUrl: checkout.checkout_url,
        checkoutClaimToken: null,
        checkoutClaimedAt: null,
        lastError: null,
        updatedAt: sql`now()`
      }).where(and(
        eq(workspaceInvoices.id, reservation.invoice.id),
        eq(workspaceInvoices.checkoutClaimToken, claimToken)
      )).returning({ id: workspaceInvoices.id })
      if (!updatedInvoice) {
        throw createError({ statusCode: 409, statusMessage: 'This checkout creation lease expired before it could be saved.' })
      }
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
    return { checkoutUrl: checkout.checkout_url, reference: reservation.invoice.reference }
  } catch (error) {
    await db.update(workspaceInvoices).set({
      checkoutClaimToken: null,
      checkoutClaimedAt: null,
      lastError: String((error as { statusMessage?: string })?.statusMessage ?? error).slice(0, 1000),
      updatedAt: sql`now()`
    }).where(and(
      eq(workspaceInvoices.id, reservation.invoice.id),
      eq(workspaceInvoices.checkoutClaimToken, claimToken)
    ))
    await enqueueBillingReconciliation(input.workspaceId, now)
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
    const subscriptionId = row.bachsSubscriptionId
    if (!await renewBillingReconciliationClaim(workspaceId, claim.token)) {
      throw createError({ statusCode: 503, statusMessage: 'A newer billing check replaced this cancellation request.' })
    }
    const subscription = await cancelBachsSubscription(
      subscriptionId,
      `perch-cancel-${workspaceId}-${subscriptionId}`
    )
    if (subscription.id !== subscriptionId) {
      throw createError({ statusCode: 502, statusMessage: 'Bachs returned a different subscription.' })
    }
    const identity = providerSubscriptionIdentity(subscription)
    if (!identity
      || identity.workspaceId !== workspaceId
      || identity.invoiceReference !== row.lastInvoiceReference
      || identity.interval !== row.interval) {
      throw createError({ statusCode: 502, statusMessage: 'Bachs cancellation did not match this workspace billing record.' })
    }
    if (!subscription.cancel_at_period_end && subscription.status !== 'canceled') {
      throw createError({ statusCode: 502, statusMessage: 'Bachs did not confirm the cancellation.' })
    }
    const end = subscription.current_period_end ? new Date(subscription.current_period_end) : row.currentPeriodEnd
    const updated = await db.transaction(async (tx) => {
      const [activeClaim] = await tx.select({ token: billingReconciliationJobs.claimToken })
        .from(billingReconciliationJobs)
        .where(and(
          eq(billingReconciliationJobs.workspaceId, workspaceId),
          eq(billingReconciliationJobs.claimToken, claim.token)
        )).limit(1).for('update')
      if (!activeClaim) return false
      const [updatedSubscription] = await tx.update(workspaceSubscriptions).set({
        status: subscription.status,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: end,
        updatedAt: sql`now()`
      }).where(and(
        eq(workspaceSubscriptions.workspaceId, workspaceId),
        eq(workspaceSubscriptions.bachsSubscriptionId, subscriptionId)
      )).returning({ workspaceId: workspaceSubscriptions.workspaceId })
      return Boolean(updatedSubscription)
    })
    if (!updated) {
      throw createError({ statusCode: 503, statusMessage: 'A newer billing check replaced this cancellation result. Please check the current status.' })
    }
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
  const [entitlement, invoices, reconciliation, subscription, financialConflicts] = await Promise.all([
    workspaceEntitlement(workspaceId),
    db.select({
      id: workspaceInvoices.id,
      reference: workspaceInvoices.reference,
      status: workspaceInvoices.status,
      interval: workspaceInvoices.interval,
      amountCents: workspaceInvoices.amountCents,
      currency: workspaceInvoices.currency,
      paidAt: workspaceInvoices.paidAt,
      checkoutClosedAt: workspaceInvoices.checkoutClosedAt,
      createdAt: workspaceInvoices.createdAt
    }).from(workspaceInvoices).where(eq(workspaceInvoices.workspaceId, workspaceId))
      .orderBy(desc(workspaceInvoices.createdAt)).limit(24),
    db.query.billingReconciliationJobs.findFirst({ where: eq(billingReconciliationJobs.workspaceId, workspaceId) }),
    db.query.workspaceSubscriptions.findFirst({ where: eq(workspaceSubscriptions.workspaceId, workspaceId) }),
    db.select({ id: billingFinancialConflicts.id })
      .from(billingFinancialConflicts)
      .where(and(
        eq(billingFinancialConflicts.workspaceId, workspaceId),
        eq(billingFinancialConflicts.status, 'open')
      )).limit(1)
  ])
  return {
    entitlement,
    checkoutEnabled: billingCheckoutEnabled() && bachsConfigured(),
    providerConfigured: bachsConfigured(),
    hasBillingHistory: invoices.length > 0 || entitlement.providerSubscriptionConnected,
    needsProviderSubscription: invoices.some(invoice => invoice.status === 'paid'
      && !invoice.checkoutClosedAt
      && (!subscription?.bachsSubscriptionId || subscription.lastInvoiceReference !== invoice.reference)),
    needsFinancialReview: financialConflicts.length > 0,
    reconciliation: reconciliation
      ? {
          status: reconciliation.status,
          lastCheckedAt: reconciliation.lastCheckedAt?.toISOString() ?? null,
          nextAttemptAt: reconciliation.nextAttemptAt?.toISOString() ?? null,
          needsAttention: reconciliation.status === 'failed',
          attempts: reconciliation.attempts,
          error: reconciliation.lastError ? safeBillingError(reconciliation.lastError) : null,
          correlationId: reconciliation.correlationId
        }
      : null,
    invoices: invoices.map(row => ({
      id: row.id,
      reference: row.reference,
      status: row.status,
      interval: row.interval,
      amountCents: row.amountCents,
      currency: row.currency,
      paidAt: row.paidAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString()
    }))
  }
}

async function applyCanonicalBillingSnapshot(input: {
  workspaceId: string
  claimToken: string
  invoice: typeof workspaceInvoices.$inferSelect | undefined
  checkout: BachsCheckoutSession | null
  subscription: BachsSubscription | null
  now: Date
}) {
  return useDb().transaction(async (tx) => {
    const [activeClaim] = await tx.select({ token: billingReconciliationJobs.claimToken })
      .from(billingReconciliationJobs)
      .where(and(
        eq(billingReconciliationJobs.workspaceId, input.workspaceId),
        eq(billingReconciliationJobs.claimToken, input.claimToken)
      )).limit(1).for('update')
    if (!activeClaim) return { staleClaim: true as const }

    const invoice = input.invoice
      ? (await tx.select().from(workspaceInvoices).where(and(
          eq(workspaceInvoices.id, input.invoice.id),
          eq(workspaceInvoices.workspaceId, input.workspaceId)
        )).limit(1).for('update'))[0]
      : undefined
    if (input.checkout && (!invoice || !checkoutMatchesInvoice(input.checkout, invoice))) {
      throw createError({ statusCode: 502, statusMessage: 'Bachs checkout did not match the local invoice.' })
    }

    let invoiceOutcome: {
      applied: boolean
      reason: 'unknown-checkout' | 'provider-pending' | 'provider-failed' | 'paid' | 'already-paid'
      workspaceId: string
    } = { applied: false, reason: 'unknown-checkout', workspaceId: input.workspaceId }
    let pendingCheckout = false
    let pendingRecoveryUntil: Date | null = null
    let terminalRecoveryUntil: Date | null = null
    if (input.checkout && invoice) {
      const state = checkoutPaymentState(input.checkout)
      if (state === 'pending') {
        pendingCheckout = true
        pendingRecoveryUntil = invoice.reconcileUntil
        invoiceOutcome = { applied: false, reason: 'provider-pending', workspaceId: input.workspaceId }
      } else if (state === 'failed') {
        const reason = `Bachs checkout is ${input.checkout.charge?.status ?? input.checkout.status}.`.slice(0, 1000)
        const insideRecoveryWindow = Boolean(invoice.reconcileUntil && invoice.reconcileUntil > input.now)
        terminalRecoveryUntil = insideRecoveryWindow ? invoice.reconcileUntil : null
        const changed = invoice.status !== 'failed'
          || invoice.lastError !== reason
          || (!insideRecoveryWindow && !invoice.checkoutClosedAt)
        if (changed) {
          await tx.update(workspaceInvoices).set({
            status: 'failed',
            paidAt: null,
            checkoutClosedAt: insideRecoveryWindow ? null : sql`now()`,
            lastError: reason,
            updatedAt: sql`now()`
          }).where(eq(workspaceInvoices.id, invoice.id))
        }
        invoiceOutcome = { applied: changed, reason: 'provider-failed', workspaceId: input.workspaceId }
      } else {
        const changed = invoice.status !== 'paid'
          || invoice.bachsChargeId !== (input.checkout.charge?.payment_id ?? invoice.bachsChargeId)
        if (changed) {
          await tx.update(workspaceInvoices).set({
            status: 'paid',
            paidAt: invoice.paidAt ?? sql`now()`,
            bachsChargeId: input.checkout.charge?.payment_id ?? invoice.bachsChargeId,
            lastError: null,
            updatedAt: sql`now()`
          }).where(eq(workspaceInvoices.id, invoice.id))
        }
        invoiceOutcome = {
          applied: changed,
          reason: changed ? 'paid' : 'already-paid',
          workspaceId: input.workspaceId
        }
      }
    }

    let subscriptionUpdated = false
    let subscriptionIgnored = false
    let conflictingSubscriptionId: string | null = null
    let conflictingInvoiceReference: string | null = null
    if (input.subscription) {
      const identity = providerSubscriptionIdentity(input.subscription)
      if (!identity || identity.workspaceId !== input.workspaceId) {
        throw createError({ statusCode: 502, statusMessage: 'Bachs subscription did not match this workspace.' })
      }
      const [subscriptionInvoice] = await tx.select().from(workspaceInvoices).where(and(
        eq(workspaceInvoices.workspaceId, input.workspaceId),
        eq(workspaceInvoices.reference, identity.invoiceReference),
        eq(workspaceInvoices.interval, identity.interval)
      )).limit(1).for('update')
      if (!subscriptionInvoice?.bachsCheckoutId
        || (subscriptionInvoice.bachsProductId && subscriptionInvoice.bachsProductId !== identity.productId)
        || !invoiceMatchesPerchPlan(subscriptionInvoice)) {
        throw createError({ statusCode: 502, statusMessage: 'Bachs subscription did not match a valid Perch invoice.' })
      }
      const [existingSubscription] = await tx.select().from(workspaceSubscriptions)
        .where(eq(workspaceSubscriptions.workspaceId, input.workspaceId)).limit(1).for('update')
      const existingInvoice = existingSubscription?.lastInvoiceReference
        ? (await tx.select().from(workspaceInvoices).where(and(
            eq(workspaceInvoices.workspaceId, input.workspaceId),
            eq(workspaceInvoices.reference, existingSubscription.lastInvoiceReference)
          )).limit(1))[0]
        : undefined
      const replacingLineage = Boolean(existingSubscription && (
        (existingSubscription.lastInvoiceReference && existingSubscription.lastInvoiceReference !== identity.invoiceReference)
        || (existingSubscription.bachsSubscriptionId && existingSubscription.bachsSubscriptionId !== input.subscription.id)
      ))
      const incomingWasSuperseded = Boolean(
        subscriptionInvoice.checkoutClosedAt
        && existingSubscription?.lastInvoiceReference !== identity.invoiceReference
      )
      if (replacingLineage) {
        const existingStillPaid = subscriptionHasPaidAccess(
          existingSubscription,
          existingInvoice?.status === 'paid',
          input.now
        )
        const incomingIsNewer = Boolean(existingInvoice && subscriptionInvoice.createdAt > existingInvoice.createdAt)
        if (incomingWasSuperseded || existingStillPaid || !incomingIsNewer) {
          subscriptionIgnored = true
          const incomingEnd = providerPaidThroughEnd(input.subscription)
          if (input.subscription.status !== 'canceled' || (incomingEnd && incomingEnd > input.now)) {
            conflictingSubscriptionId = input.subscription.id
            conflictingInvoiceReference = subscriptionInvoice.reference
          }
        } else if (existingSubscription?.bachsSubscriptionId && existingSubscription.status !== 'canceled') {
          conflictingSubscriptionId = existingSubscription.bachsSubscriptionId
          conflictingInvoiceReference = existingInvoice?.reference ?? existingSubscription.lastInvoiceReference
        }
      }
      if (!subscriptionIgnored) {
        const end = providerPaidThroughEnd(input.subscription)
        await tx.insert(workspaceSubscriptions).values({
          workspaceId: input.workspaceId,
          status: input.subscription.status,
          interval: identity.interval,
          currentPeriodEnd: end,
          cancelAtPeriodEnd: Boolean(input.subscription.cancel_at_period_end),
          bachsSubscriptionId: input.subscription.id,
          lastInvoiceReference: identity.invoiceReference
        }).onConflictDoUpdate({
          target: workspaceSubscriptions.workspaceId,
          set: {
            status: input.subscription.status,
            interval: identity.interval,
            currentPeriodEnd: end,
            cancelAtPeriodEnd: Boolean(input.subscription.cancel_at_period_end),
            bachsSubscriptionId: input.subscription.id,
            lastInvoiceReference: identity.invoiceReference,
            updatedAt: sql`now()`
          }
        })
        // New checkouts persist their expected product before redirect. A
        // pre-0029 invoice has no authoritative local product id to backfill;
        // adopt it only here, after exact checkout binding and canonical
        // recurring terms above have both been verified.
        await tx.update(workspaceInvoices).set({
          bachsProductId: identity.productId,
          checkoutClosedAt: subscriptionInvoice.checkoutClosedAt ?? sql`now()`,
          updatedAt: sql`now()`
        }).where(eq(workspaceInvoices.id, subscriptionInvoice.id))
        subscriptionUpdated = true
      }
      if (conflictingSubscriptionId) {
        const conflictInvoice = conflictingInvoiceReference === subscriptionInvoice.reference
          ? subscriptionInvoice
          : existingInvoice
        const canonicalSubscriptionId = subscriptionIgnored
          ? existingSubscription?.bachsSubscriptionId ?? null
          : input.subscription.id
        await tx.insert(billingFinancialConflicts).values({
          workspaceId: input.workspaceId,
          canonicalSubscriptionId,
          conflictingSubscriptionId,
          invoiceReference: conflictingInvoiceReference,
          amountCents: conflictInvoice?.amountCents ?? null,
          currency: conflictInvoice?.currency ?? null,
          providerChargeId: conflictInvoice?.bachsChargeId ?? null,
          correlationId: input.claimToken,
          lastError: 'Duplicate subscription requires cancellation and refund review.'
        }).onConflictDoUpdate({
          target: billingFinancialConflicts.conflictingSubscriptionId,
          set: {
            status: 'open',
            canonicalSubscriptionId,
            invoiceReference: conflictingInvoiceReference,
            amountCents: conflictInvoice?.amountCents ?? null,
            currency: conflictInvoice?.currency ?? null,
            providerChargeId: conflictInvoice?.bachsChargeId ?? null,
            correlationId: input.claimToken,
            lastError: 'Duplicate subscription requires cancellation and refund review.',
            resolvedAt: null,
            updatedAt: sql`now()`
          }
        })
      }
    }

    return {
      staleClaim: false as const,
      invoiceOutcome,
      subscriptionUpdated,
      subscriptionIgnored,
      conflictingSubscriptionId,
      conflictingInvoiceReference,
      pendingCheckout,
      pendingRecoveryUntil,
      terminalRecoveryUntil
    }
  })
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

async function renewBillingReconciliationClaim(workspaceId: string, token: string) {
  const [renewed] = await useDb().update(billingReconciliationJobs).set({
    claimedAt: sql`now()`,
    updatedAt: sql`now()`
  }).where(and(
    eq(billingReconciliationJobs.workspaceId, workspaceId),
    eq(billingReconciliationJobs.status, 'processing'),
    eq(billingReconciliationJobs.claimToken, token)
  )).returning({ workspaceId: billingReconciliationJobs.workspaceId })
  return Boolean(renewed)
}

function billingReconciliationRetryAt(attempts: number, now: Date) {
  const delays = [5, 15, 60, 180, 360, 360]
  return new Date(now.getTime() + delays[Math.min(attempts - 1, delays.length - 1)]! * 60_000)
}

function nextSuccessfulBillingCheck(input: {
  pendingCheckout: boolean
  pendingRecoveryUntil?: Date | null
  terminalRecoveryUntil?: Date | null
  subscription: BachsSubscription | null
  now: Date
}) {
  if (input.pendingCheckout && input.pendingRecoveryUntil && input.pendingRecoveryUntil > input.now) {
    return new Date(Math.min(
      input.now.getTime() + RECONCILIATION_POLL_MS,
      input.pendingRecoveryUntil.getTime()
    ))
  }
  if (input.terminalRecoveryUntil && input.terminalRecoveryUntil > input.now) {
    return new Date(Math.min(
      input.now.getTime() + 60 * 60_000,
      input.terminalRecoveryUntil.getTime()
    ))
  }
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
    correlationId: token,
    updatedAt: sql`now()`
  }).where(and(
    eq(billingReconciliationJobs.workspaceId, workspaceId),
    eq(billingReconciliationJobs.claimToken, token)
  )).returning({ workspaceId: billingReconciliationJobs.workspaceId })
  return Boolean(updated)
}

async function failBillingReconciliation(
  workspaceId: string,
  token: string,
  error: unknown,
  now: Date,
  options: { terminal?: boolean } = {}
) {
  const current = await useDb().query.billingReconciliationJobs.findFirst({
    where: and(
      eq(billingReconciliationJobs.workspaceId, workspaceId),
      eq(billingReconciliationJobs.claimToken, token)
    )
  })
  if (!current) return
  const attempts = options.terminal
    ? RECONCILIATION_MAX_FAILURES
    : Math.min(current.attempts + 1, RECONCILIATION_MAX_FAILURES)
  const terminal = options.terminal || (attempts >= RECONCILIATION_MAX_FAILURES && !current.requestedAt)
  const nowIso = now.toISOString()
  const retryIso = terminal ? null : billingReconciliationRetryAt(attempts, now).toISOString()
  const [updated] = await useDb().update(billingReconciliationJobs).set({
    status: options.terminal
      ? 'failed'
      : sql`case when ${billingReconciliationJobs.requestedAt} is not null then 'retrying'::billing_reconciliation_status else ${terminal ? 'failed' : 'retrying'}::billing_reconciliation_status end`,
    attempts,
    claimToken: null,
    claimedAt: null,
    requestedAt: null,
    nextAttemptAt: options.terminal
      ? null
      : sql`case when ${billingReconciliationJobs.requestedAt} is not null then ${nowIso}::timestamptz else ${retryIso}::timestamptz end`,
    lastCheckedAt: now,
    lastError: safeBillingError(error),
    correlationId: token,
    updatedAt: sql`now()`
  }).where(and(
    eq(billingReconciliationJobs.workspaceId, workspaceId),
    eq(billingReconciliationJobs.claimToken, token)
  )).returning({ status: billingReconciliationJobs.status })
  if (updated?.status === 'failed') {
    console.error('[billing-reconciliation] job moved to dead letter', {
      workspaceId,
      correlationId: token,
      attempts
    })
  }
}

function safeBillingError(error: unknown) {
  return String((error as { statusMessage?: string })?.statusMessage ?? (error as Error)?.message ?? error)
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\b(?:sk|whsec)_[A-Za-z0-9_-]+\b/g, '[redacted-secret]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .slice(0, 1000)
}

async function containFinancialConflict(
  workspaceId: string,
  claimToken: string,
  conflict: { conflictingSubscriptionId: string, conflictingInvoiceReference: string | null }
) {
  await useDb().update(billingFinancialConflicts).set({
    attempts: sql`${billingFinancialConflicts.attempts} + 1`,
    correlationId: claimToken,
    lastError: 'Verified cancellation and duplicate charge/refund review are required.',
    updatedAt: sql`now()`
  }).where(and(
    eq(billingFinancialConflicts.workspaceId, workspaceId),
    eq(billingFinancialConflicts.conflictingSubscriptionId, conflict.conflictingSubscriptionId),
    eq(billingFinancialConflicts.status, 'open')
  ))
  throw createError({
    statusCode: 409,
    statusMessage: 'A duplicate paid subscription needs verified cancellation and operator refund review. Billing reconciliation remains blocked.'
  })
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

async function reconcileWorkspaceBillingUnderClaim(
  workspaceId: string,
  claimToken: string,
  options: ReconcileWorkspaceBillingOptions
) {
  const db = useDb()
  const subscriptionRow = await db.query.workspaceSubscriptions.findFirst({
    where: eq(workspaceSubscriptions.workspaceId, workspaceId)
  })
  const snapshotIdentity = options.subscriptionSnapshot
    ? providerSubscriptionIdentity(options.subscriptionSnapshot)
    : null
  if (options.subscriptionSnapshot && (!snapshotIdentity || snapshotIdentity.workspaceId !== workspaceId)) {
    throw createError({ statusCode: 502, statusMessage: 'Bachs subscription did not match this workspace.' })
  }

  // A canonical checkout may expose its subscription id after payment. That
  // lets Perch recover a missed webhook without listing or guessing provider
  // resources. Each reconciliation still reads at most one checkout and one
  // exact subscription.
  const latestOpenInvoice = !options.invoiceReference && !options.checkoutId && !options.subscriptionSnapshot
    ? await db.query.workspaceInvoices.findFirst({ where: and(
        eq(workspaceInvoices.workspaceId, workspaceId),
        isNull(workspaceInvoices.checkoutClosedAt),
        sql`${workspaceInvoices.bachsCheckoutId} is not null`
      ), orderBy: desc(workspaceInvoices.createdAt) })
    : undefined
  const targetReference = options.invoiceReference
    ?? (options.subscriptionSnapshot ? snapshotIdentity?.invoiceReference : null)
    ?? latestOpenInvoice?.reference
    ?? subscriptionRow?.lastInvoiceReference
    ?? snapshotIdentity?.invoiceReference
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
      isNull(workspaceInvoices.checkoutClosedAt),
      sql`${workspaceInvoices.bachsCheckoutId} is not null`
    ), orderBy: desc(workspaceInvoices.createdAt) })
  }
  const canonicalCheckout = invoice?.bachsCheckoutId
    ? await getBachsCheckoutSession(invoice.bachsCheckoutId)
    : null

  if (canonicalCheckout && !checkoutMatchesInvoice(canonicalCheckout, invoice!)) {
    throw createError({ statusCode: 502, statusMessage: 'Bachs checkout did not match the local invoice.' })
  }
  const canonicalCheckoutState = canonicalCheckout ? checkoutPaymentState(canonicalCheckout) : null
  const checkoutSubscriptionId = canonicalCheckoutState === 'paid'
    ? canonicalCheckout?.subscription_id ?? null
    : null
  const subscriptionId = canonicalCheckoutState && canonicalCheckoutState !== 'paid'
    ? options.subscriptionSnapshot ? options.subscriptionId ?? null : null
    : checkoutSubscriptionId
      ?? options.subscriptionId
      ?? subscriptionRow?.bachsSubscriptionId
      ?? null
  if (options.subscriptionSnapshot && options.subscriptionSnapshot.id !== subscriptionId) {
    throw createError({
      statusCode: 502,
      statusMessage: 'The checkout is linked to a different Bachs subscription.'
    })
  }
  const canonicalSubscription = options.subscriptionSnapshot
    ?? (subscriptionId ? await getBachsSubscription(subscriptionId) : null)
  const subscriptionIdentity = canonicalSubscription ? providerSubscriptionIdentity(canonicalSubscription) : null
  if (canonicalSubscription && canonicalSubscription.id !== subscriptionId) {
    throw createError({ statusCode: 502, statusMessage: 'Bachs returned a different subscription.' })
  }
  if (canonicalSubscription && (!subscriptionIdentity || subscriptionIdentity.workspaceId !== workspaceId)) {
    throw createError({ statusCode: 502, statusMessage: 'Bachs subscription did not match this workspace.' })
  }
  if (canonicalCheckout && canonicalSubscription
    && canonicalCheckout.subscription_id !== canonicalSubscription.id) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bachs did not bind the checkout to the exact subscription.'
    })
  }
  if (canonicalCheckout && canonicalSubscription && checkoutPaymentState(canonicalCheckout) !== 'paid') {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bachs did not confirm a paid checkout for this subscription.'
    })
  }
  if (subscriptionIdentity) {
    const subscriptionInvoice = invoice?.reference === subscriptionIdentity.invoiceReference
      ? invoice
      : await db.query.workspaceInvoices.findFirst({ where: and(
          eq(workspaceInvoices.workspaceId, workspaceId),
          eq(workspaceInvoices.reference, subscriptionIdentity.invoiceReference),
          eq(workspaceInvoices.interval, subscriptionIdentity.interval)
        ) })
    if (!subscriptionInvoice?.bachsCheckoutId
      || (subscriptionInvoice.bachsProductId && subscriptionInvoice.bachsProductId !== subscriptionIdentity.productId)
      || !invoiceMatchesPerchPlan(subscriptionInvoice)) {
      throw createError({ statusCode: 502, statusMessage: 'Bachs subscription did not match a valid Perch invoice.' })
    }
  }

  const providerResourcesChecked = (canonicalCheckout ? 1 : 0) + (canonicalSubscription ? 1 : 0)
  if (providerResourcesChecked === 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'There is no Bachs checkout or subscription connected to this workspace yet.'
    })
  }

  const applied = await applyCanonicalBillingSnapshot({
    workspaceId,
    claimToken,
    invoice,
    checkout: canonicalCheckout,
    subscription: canonicalSubscription,
    now: options.now ?? new Date()
  })
  if (applied.staleClaim) {
    throw createError({
      statusCode: 503,
      statusMessage: 'A newer billing check replaced this provider response. Please check the current status.'
    })
  }
  if (applied.conflictingSubscriptionId) {
    await containFinancialConflict(workspaceId, claimToken, {
      conflictingSubscriptionId: applied.conflictingSubscriptionId,
      conflictingInvoiceReference: applied.conflictingInvoiceReference
    })
  }
  return {
    invoiceOutcome: applied.invoiceOutcome,
    invoicesChecked: canonicalCheckout ? 1 : 0,
    invoicesChanged: applied.invoiceOutcome.applied ? 1 : 0,
    subscriptionChecked: Boolean(canonicalSubscription),
    subscriptionUpdated: applied.subscriptionUpdated,
    subscriptionIgnored: applied.subscriptionIgnored,
    pendingCheckout: applied.pendingCheckout,
    pendingRecoveryUntil: applied.pendingRecoveryUntil,
    terminalRecoveryUntil: applied.terminalRecoveryUntil,
    canonicalSubscription,
    providerResourcesChecked
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
    const result = await reconcileWorkspaceBillingUnderClaim(workspaceId, claim.token, { ...options, now })
    if (result.pendingCheckout
      && (!result.pendingRecoveryUntil || result.pendingRecoveryUntil <= now)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A Bachs checkout is still pending after its bounded verification window. Automatic checks stopped and operator review is required.'
      })
    }
    const nextAttemptAt = nextSuccessfulBillingCheck({
      pendingCheckout: result.pendingCheckout,
      pendingRecoveryUntil: result.pendingRecoveryUntil,
      terminalRecoveryUntil: result.terminalRecoveryUntil,
      subscription: result.canonicalSubscription,
      now
    })
    if (!await finishBillingReconciliation(workspaceId, claim.token, nextAttemptAt, new Date())) {
      throw createError({ statusCode: 503, statusMessage: 'A newer billing check replaced this completion.' })
    }
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
    if ((error as { statusCode?: number })?.statusCode === 409
      && String((error as { statusMessage?: string })?.statusMessage).startsWith('There is no Bachs checkout')) {
      await finishBillingReconciliation(workspaceId, claim.token, null, new Date())
      throw error
    }
    const agedPendingCheckout = String((error as { statusMessage?: string })?.statusMessage)
      .startsWith('A Bachs checkout is still pending after its bounded verification window')
    await failBillingReconciliation(workspaceId, claim.token, error, now, { terminal: agedPendingCheckout })
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
  const claimToken = randomUUID()
  const [created] = await db.insert(billingWebhookDeliveries).values({ providerEventId, eventType, claimToken }).onConflictDoNothing().returning()
  if (created) return { delivery: created, claimToken, shouldProcess: true }
  const stale = new Date(Date.now() - 5 * 60_000)
  const [reclaimed] = await db.update(billingWebhookDeliveries).set({
    status: 'processing',
    attempts: sql`${billingWebhookDeliveries.attempts} + 1`,
    claimToken,
    lastError: null,
    updatedAt: sql`now()`
  }).where(and(
    eq(billingWebhookDeliveries.providerEventId, providerEventId),
    or(eq(billingWebhookDeliveries.status, 'failed'), and(eq(billingWebhookDeliveries.status, 'processing'), lt(billingWebhookDeliveries.updatedAt, stale)))
  )).returning()
  const delivery = reclaimed ?? await db.query.billingWebhookDeliveries.findFirst({ where: eq(billingWebhookDeliveries.providerEventId, providerEventId) })
  return { delivery: delivery!, claimToken: reclaimed ? claimToken : null, shouldProcess: Boolean(reclaimed) }
}

export async function finishBillingWebhook(id: string, claimToken: string, status: 'completed' | 'ignored', error?: string) {
  const [finished] = await useDb().update(billingWebhookDeliveries).set({
    status,
    claimToken: null,
    lastError: error ?? null,
    updatedAt: sql`now()`
  }).where(and(
    eq(billingWebhookDeliveries.id, id),
    eq(billingWebhookDeliveries.status, 'processing'),
    eq(billingWebhookDeliveries.claimToken, claimToken)
  )).returning({ id: billingWebhookDeliveries.id })
  return Boolean(finished)
}

export async function requireBillingWebhookFinish(
  id: string,
  claimToken: string,
  status: 'completed' | 'ignored'
) {
  if (!await finishBillingWebhook(id, claimToken, status)) {
    throw createError({
      statusCode: 503,
      statusMessage: 'A newer webhook handler replaced this completion. Retry the signed event.'
    })
  }
}

export async function failBillingWebhook(id: string, claimToken: string, error: unknown) {
  const [failed] = await useDb().update(billingWebhookDeliveries).set({
    status: 'failed', claimToken: null, lastError: safeBillingError(error), updatedAt: sql`now()`
  }).where(and(
    eq(billingWebhookDeliveries.id, id),
    eq(billingWebhookDeliveries.status, 'processing'),
    eq(billingWebhookDeliveries.claimToken, claimToken)
  )).returning({ id: billingWebhookDeliveries.id })
  return Boolean(failed)
}

export async function workspaceBillingCustomer(workspaceId: string, userId: string) {
  const [row] = await useDb().select({
    email: users.email,
    name: users.name,
    emailVerifiedAt: users.emailVerifiedAt
  })
    .from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))).limit(1)
  if (!row) throw createError({ statusCode: 403, statusMessage: 'Workspace membership required.' })
  if (!row.emailVerifiedAt) {
    throw createError({ statusCode: 403, statusMessage: 'Verify your email address before starting a paid subscription.' })
  }
  return { email: row.email, name: row.name }
}
