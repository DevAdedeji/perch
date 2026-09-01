import { and, billingWebhookDeliveries, desc, eq, lt, or, sql, users, workspaceInvoices, workspaceMembers, workspaceSubscriptions } from '@perch/db'
import type { BillingInterval, SubscriptionStatus } from '@perch/shared'
import { PERCH_PRO_PLAN, proPriceCents } from '@perch/shared'
import type { BachsSubscription } from './bachs'

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

function hasPaidAccess(row: typeof workspaceSubscriptions.$inferSelect | undefined, now = new Date()) {
  if (!row) return false
  if (row.status === 'active' || row.status === 'trialing') return true
  if (row.status !== 'past_due' && row.status !== 'canceled') return false
  return Boolean(row.currentPeriodEnd && row.currentPeriodEnd.getTime() > now.getTime())
}

export async function workspaceEntitlement(workspaceId: string): Promise<WorkspaceEntitlement> {
  const row = await useDb().query.workspaceSubscriptions.findFirst({ where: eq(workspaceSubscriptions.workspaceId, workspaceId) })
  const isPro = hasPaidAccess(row)
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
  if (existing?.status === 'pending' && existing.checkoutUrl) return { checkoutUrl: existing.checkoutUrl, reference }
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
      metadata: { workspaceId: input.workspaceId, interval: input.interval, perchPlan: 'workspace_pro' }
    })
    if (!checkout.checkout_url) throw createError({ statusCode: 502, statusMessage: 'Bachs did not return a checkout URL.' })
    await db.transaction(async (tx) => {
      await tx.update(workspaceInvoices).set({
        bachsCheckoutId: checkout.checkout_id,
        checkoutUrl: checkout.checkout_url,
        updatedAt: sql`now()`
      }).where(eq(workspaceInvoices.id, invoice!.id))
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
    }).where(eq(workspaceInvoices.id, invoice!.id))
    throw error
  }
}

export async function cancelWorkspacePlan(workspaceId: string) {
  const db = useDb()
  const row = await db.query.workspaceSubscriptions.findFirst({ where: eq(workspaceSubscriptions.workspaceId, workspaceId) })
  if (!row || !hasPaidAccess(row)) throw createError({ statusCode: 409, statusMessage: 'Perch Pro is not active.' })
  if (!row.bachsSubscriptionId) {
    return { cancelAtPeriodEnd: true, currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null }
  }
  const subscription = await cancelBachsSubscription(row.bachsSubscriptionId)
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
    configured: bachsConfigured(),
    invoices: invoices.map(row => ({
      ...row,
      paidAt: row.paidAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString()
    }))
  }
}

export async function applyWorkspaceSubscriptionState(subscription: BachsSubscription) {
  const workspaceId = subscription.metadata?.workspaceId
  if (!workspaceId || subscription.metadata?.perchPlan !== 'workspace_pro') return { applied: false, reason: 'not-perch-pro' as const }
  const interval: BillingInterval = subscription.product?.metadata?.perch_plan?.endsWith('_yearly')
    || subscription.metadata.interval === 'yearly'
    ? 'yearly'
    : 'monthly'
  const end = subscription.current_period_end ?? subscription.next_billed_at
  await useDb().insert(workspaceSubscriptions).values({
    workspaceId,
    status: subscription.status,
    interval,
    currentPeriodEnd: end ? new Date(end) : null,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    bachsSubscriptionId: subscription.id
  }).onConflictDoUpdate({
    target: workspaceSubscriptions.workspaceId,
    set: {
      status: subscription.status,
      interval,
      currentPeriodEnd: end ? new Date(end) : null,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      bachsSubscriptionId: subscription.id,
      updatedAt: sql`now()`
    }
  })
  return { applied: true, workspaceId }
}

export async function markWorkspaceInvoicePaid(reference: string, chargeId?: string | null) {
  return useDb().transaction(async (tx) => {
    const [invoice] = await tx.select().from(workspaceInvoices).where(eq(workspaceInvoices.reference, reference)).limit(1).for('update')
    if (!invoice) return { applied: false, reason: 'unknown-reference' as const }
    if (invoice.status === 'paid') return { applied: false, reason: 'already-paid' as const, workspaceId: invoice.workspaceId }
    await tx.update(workspaceInvoices).set({
      status: 'paid', paidAt: sql`now()`, bachsChargeId: chargeId ?? invoice.bachsChargeId, updatedAt: sql`now()`
    }).where(eq(workspaceInvoices.id, invoice.id))
    await tx.insert(workspaceSubscriptions).values({
      workspaceId: invoice.workspaceId,
      status: 'active',
      interval: invoice.interval,
      currentPeriodEnd: invoice.periodEnd,
      lastInvoiceReference: invoice.reference
    }).onConflictDoUpdate({
      target: workspaceSubscriptions.workspaceId,
      set: {
        status: 'active', interval: invoice.interval, currentPeriodEnd: invoice.periodEnd,
        cancelAtPeriodEnd: false, lastInvoiceReference: invoice.reference, updatedAt: sql`now()`
      }
    })
    return { applied: true, reason: 'paid' as const, workspaceId: invoice.workspaceId }
  })
}

export async function markWorkspaceInvoiceFailed(reference: string, reason: string) {
  const rows = await useDb().update(workspaceInvoices).set({
    status: 'failed', lastError: reason.slice(0, 1000), updatedAt: sql`now()`
  }).where(eq(workspaceInvoices.reference, reference)).returning({ id: workspaceInvoices.id })
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
