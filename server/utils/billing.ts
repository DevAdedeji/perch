import { and, billingWebhookDeliveries, desc, eq, lt, or, sql, users, workspaceInvoices, workspaceMembers, workspaces, workspaceSubscriptions } from '@perch/db'
import type { BillingInterval, SubscriptionStatus } from '@perch/shared'
import { PERCH_PRO_PLAN, proPriceCents } from '@perch/shared'
import type { BachsCheckoutSession, BachsSubscription } from './bachs'
import { explicitlyEnabled } from '../../config/launch'

export interface WorkspaceEntitlement {
  plan: 'free' | 'pro'
  isPro: boolean
  status: SubscriptionStatus | null
  interval: BillingInterval | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  limits: { members: number | null, reminderMinutes: number }
  features: { customReminderDelay: boolean, businessHoursReminders: boolean, removeBranding: boolean }
}

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
    || ['failed', 'canceled', 'cancelled', 'expired'].includes(paymentStatus ?? '')) return 'failed'
  return 'pending'
}

export function checkoutMatchesInvoice(
  checkout: BachsCheckoutSession,
  invoice: Pick<typeof workspaceInvoices.$inferSelect, 'reference' | 'bachsCheckoutId' | 'amountCents' | 'currency'>
) {
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
  const prepared = await db.transaction(async (tx) => {
    const workspaceRows = await tx.select({
      id: workspaces.id,
      deletionRequestedAt: workspaces.deletionRequestedAt
    }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1).for('update')
    const workspace = workspaceRows[0]
    if (!workspace) throw createError({ statusCode: 404, statusMessage: 'Workspace not found.' })
    if (workspace.deletionRequestedAt) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Workspace deletion has started, so a new paid checkout cannot be created.'
      })
    }
    const existing = await tx.query.workspaceInvoices.findFirst({ where: eq(workspaceInvoices.reference, reference) })
    if (existing) return { existing, invoice: null }

    const start = new Date()
    const end = periodEnd(start, input.interval)
    const [invoice] = await tx.insert(workspaceInvoices).values({
      workspaceId: input.workspaceId,
      reference,
      interval: input.interval,
      amountCents: proPriceCents(input.interval),
      periodStart: start,
      periodEnd: end
    }).returning()
    return { existing: null, invoice: invoice! }
  })

  const existing = prepared.existing
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
  const invoice = prepared.invoice!

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
    const expectedInvoice = { ...invoice, bachsCheckoutId: checkout.checkout_id }
    if (!checkoutMatchesInvoice(canonicalCheckout, expectedInvoice)) {
      throw createError({ statusCode: 502, statusMessage: 'Bachs checkout did not match the expected plan.' })
    }
    await db.transaction(async (tx) => {
      await tx.update(workspaceInvoices).set({
        bachsCheckoutId: checkout.checkout_id,
        checkoutUrl: checkout.checkout_url,
        updatedAt: sql`now()`
      }).where(eq(workspaceInvoices.id, invoice.id))
      await tx.insert(workspaceSubscriptions).values({
        workspaceId: input.workspaceId,
        interval: input.interval,
        lastInvoiceReference: reference
      }).onConflictDoUpdate({
        target: workspaceSubscriptions.workspaceId,
        set: { interval: input.interval, lastInvoiceReference: reference, updatedAt: sql`now()` }
      })
    })
    return { checkoutUrl: checkout.checkout_url, reference }
  } catch (error) {
    await db.update(workspaceInvoices).set({
      status: 'failed',
      lastError: String((error as { statusMessage?: string })?.statusMessage ?? error).slice(0, 1000),
      updatedAt: sql`now()`
    }).where(eq(workspaceInvoices.id, invoice.id))
    throw error
  }
}

export async function cancelWorkspacePlan(workspaceId: string) {
  const db = useDb()
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
  return { cancelAtPeriodEnd: true, currentPeriodEnd: end?.toISOString() ?? null }
}

export async function billingOverview(workspaceId: string) {
  const db = useDb()
  const [entitlement, invoices] = await Promise.all([
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
      .orderBy(desc(workspaceInvoices.createdAt)).limit(24)
  ])
  return {
    entitlement,
    checkoutEnabled: billingCheckoutEnabled() && bachsConfigured(),
    invoices: invoices.map(row => ({
      ...row,
      paidAt: row.paidAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString()
    }))
  }
}

export async function applyWorkspaceSubscriptionState(subscription: BachsSubscription) {
  const workspaceId = subscription.metadata?.workspaceId
  const invoiceReference = subscription.metadata?.invoiceReference
  if (!workspaceId || !invoiceReference || subscription.metadata?.perchPlan !== 'workspace_pro') {
    return { applied: false, reason: 'not-perch-pro' as const }
  }
  const productPlan = subscription.product?.metadata?.perch_plan
  const interval: BillingInterval | null = productPlan === 'workspace_pro_yearly'
    ? 'yearly'
    : productPlan === 'workspace_pro_monthly'
      ? 'monthly'
      : null
  if (!interval || (subscription.metadata.interval && subscription.metadata.interval !== interval)) {
    return { applied: false, reason: 'unexpected-product' as const }
  }
  const db = useDb()
  const [invoice, existingSubscription] = await Promise.all([
    db.query.workspaceInvoices.findFirst({ where: and(
      eq(workspaceInvoices.workspaceId, workspaceId),
      eq(workspaceInvoices.reference, invoiceReference),
      eq(workspaceInvoices.interval, interval)
    ) }),
    db.query.workspaceSubscriptions.findFirst({ where: eq(workspaceSubscriptions.workspaceId, workspaceId) })
  ])
  if (!invoice?.bachsCheckoutId) return { applied: false, reason: 'unknown-invoice' as const }
  if (existingSubscription?.bachsSubscriptionId && existingSubscription.bachsSubscriptionId !== subscription.id) {
    return { applied: false, reason: 'subscription-mismatch' as const }
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
      status: 'paid', paidAt: sql`now()`, bachsChargeId: chargeId ?? invoice.bachsChargeId, updatedAt: sql`now()`
    }).where(eq(workspaceInvoices.id, invoice.id))
    return { applied: true, reason: 'paid' as const, workspaceId: invoice.workspaceId }
  })
}

export async function confirmWorkspaceInvoiceFromCheckout(input: { checkoutId?: string | null, reference?: string | null }) {
  if (!input.checkoutId && !input.reference) return { applied: false, reason: 'missing-checkout' as const }
  const invoice = await useDb().query.workspaceInvoices.findFirst({ where: input.checkoutId
    ? eq(workspaceInvoices.bachsCheckoutId, input.checkoutId)
    : eq(workspaceInvoices.reference, input.reference!) })
  if (!invoice?.bachsCheckoutId) return { applied: false, reason: 'unknown-checkout' as const }

  const checkout = await getBachsCheckoutSession(invoice.bachsCheckoutId)
  if (!checkoutMatchesInvoice(checkout, invoice)) {
    throw createError({ statusCode: 502, statusMessage: 'Bachs checkout did not match the local invoice.' })
  }
  const state = checkoutPaymentState(checkout)
  if (state !== 'paid') return { applied: false, reason: state === 'failed' ? 'provider-failed' as const : 'provider-pending' as const }
  return markWorkspaceInvoicePaid(invoice.reference, checkout.charge?.payment_id)
}

export async function markWorkspaceInvoiceFailed(reference: string, reason: string) {
  const rows = await useDb().update(workspaceInvoices).set({
    status: 'failed', lastError: reason.slice(0, 1000), updatedAt: sql`now()`
  }).where(and(
    eq(workspaceInvoices.reference, reference),
    eq(workspaceInvoices.status, 'pending')
  )).returning({ id: workspaceInvoices.id })
  return Boolean(rows.length)
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
