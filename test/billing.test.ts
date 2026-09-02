import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { PERCH_PRO_PLAN, proPriceCents, toDecimalString } from '../packages/shared/src/billing'
import {
  bachsCheckoutSessionSchema,
  bachsConfigurationError,
  bachsConfigured,
  bachsSubscriptionSchema,
  bachsWebhookEventSchema,
  cancelBachsSubscription,
  getBachsCheckoutSession,
  isApprovedBachsCheckoutUrl,
  verifyBachsWebhookSignature
} from '../server/utils/bachs'
import { effectiveReminderSettings, reminderIsDue, reminderRetryAt } from '../server/utils/unanswered-reminders'
import { checkoutMatchesInvoice, checkoutPaymentState, invoiceMatchesPerchPlan, providerAmountCents, providerPaidThroughEnd, providerSubscriptionIdentity, subscriptionHasPaidAccess } from '../server/utils/billing'

describe('Perch plan pricing', () => {
  it('keeps the yearly plan cheaper than twelve monthly payments', () => {
    expect(proPriceCents('monthly')).toBe(900)
    expect(proPriceCents('yearly')).toBe(9000)
    expect(PERCH_PRO_PLAN.yearlyCents).toBeLessThan(PERCH_PRO_PLAN.monthlyCents * 12)
    expect(toDecimalString(900)).toBe('9.00')
  })

  it('keeps paid access only through a confirmed current period', () => {
    const now = new Date('2026-09-01T12:00:00.000Z')
    expect(subscriptionHasPaidAccess({ status: 'active', currentPeriodEnd: null }, true, now)).toBe(false)
    expect(subscriptionHasPaidAccess({ status: 'active', currentPeriodEnd: new Date('2026-09-02T12:00:00.000Z') }, false, now)).toBe(false)
    expect(subscriptionHasPaidAccess({ status: 'canceled', currentPeriodEnd: new Date('2026-09-02T12:00:00.000Z') }, true, now)).toBe(true)
    expect(subscriptionHasPaidAccess({ status: 'past_due', currentPeriodEnd: new Date('2026-09-02T12:00:00.000Z') }, true, now)).toBe(true)
    expect(subscriptionHasPaidAccess({ status: 'canceled', currentPeriodEnd: new Date('2026-08-31T12:00:00.000Z') }, true, now)).toBe(false)
  })
})

describe('canonical Bachs payment data', () => {
  const checkout = {
    checkout_id: 'co_123',
    status: 'completed' as const,
    payment_status: 'succeeded' as const,
    amount: '9.00',
    currency: 'USD',
    reference: 'invoice_123',
    charge: { payment_id: 'pay_123', status: 'succeeded' as const, amount: '9.00', amount_paid: '9.00', currency: 'USD' }
  }

  it('accepts only exact invoice identity, currency, and amount matches', () => {
    const invoice = { reference: 'invoice_123', bachsCheckoutId: 'co_123', interval: 'monthly' as const, amountCents: 900, currency: 'USD' }
    expect(checkoutMatchesInvoice(checkout, invoice)).toBe(true)
    expect(checkoutMatchesInvoice({ ...checkout, currency: 'NGN' }, invoice)).toBe(false)
    expect(checkoutMatchesInvoice({ ...checkout, amount: '8.99' }, invoice)).toBe(false)
    expect(checkoutMatchesInvoice({ ...checkout, reference: 'another' }, invoice)).toBe(false)
    expect(checkoutMatchesInvoice({ ...checkout, checkout_id: 'another' }, invoice)).toBe(false)
  })

  it('requires the exact Perch price and currency stored for the selected interval', () => {
    expect(invoiceMatchesPerchPlan({ interval: 'monthly', amountCents: 900, currency: 'usd' })).toBe(true)
    expect(invoiceMatchesPerchPlan({ interval: 'monthly', amountCents: 899, currency: 'USD' })).toBe(false)
    expect(invoiceMatchesPerchPlan({ interval: 'yearly', amountCents: 900, currency: 'USD' })).toBe(false)
    expect(invoiceMatchesPerchPlan({ interval: 'monthly', amountCents: 900, currency: 'NGN' })).toBe(false)
  })

  it('does not treat an unconfirmed completed checkout as paid', () => {
    expect(checkoutPaymentState(checkout)).toBe('paid')
    expect(checkoutPaymentState({ ...checkout, payment_status: 'processing', charge: null })).toBe('pending')
    expect(checkoutPaymentState({ ...checkout, status: 'expired', payment_status: 'failed', charge: null })).toBe('failed')
    expect(checkoutPaymentState({ ...checkout, charge: { ...checkout.charge, status: 'refunded' } })).toBe('failed')
    expect(checkoutPaymentState({ ...checkout, charge: { ...checkout.charge, status: 'underpaid' } })).toBe('failed')
  })

  it('binds a canonical subscription to one workspace, invoice, product, and interval', () => {
    const subscription = {
      id: 'sub_123',
      status: 'active' as const,
      metadata: { workspaceId: 'workspace_123', invoiceReference: 'invoice_123', perchPlan: 'workspace_pro', interval: 'monthly' },
      product: { id: 'product_123', metadata: { perch_plan: 'workspace_pro_monthly' } }
    }
    expect(providerSubscriptionIdentity(subscription)).toEqual({
      workspaceId: 'workspace_123', invoiceReference: 'invoice_123', interval: 'monthly'
    })
    expect(providerSubscriptionIdentity({
      ...subscription,
      metadata: { ...subscription.metadata, interval: 'yearly' }
    })).toBeNull()
    expect(providerSubscriptionIdentity({
      ...subscription,
      product: { ...subscription.product, metadata: { perch_plan: 'another_product' } }
    })).toBeNull()
  })

  it('parses money without rounding provider values', () => {
    expect(providerAmountCents('9')).toBe(900)
    expect(providerAmountCents('9.00')).toBe(900)
    expect(providerAmountCents('9.001')).toBeNull()
    expect(providerAmountCents('nine')).toBeNull()
  })

  it('uses only a paid-through or trial-end boundary for access', () => {
    expect(providerPaidThroughEnd({
      id: 'sub_active', status: 'active', next_billed_at: '2026-10-01T00:00:00.000Z'
    })).toBeNull()
    expect(providerPaidThroughEnd({
      id: 'sub_trial', status: 'trialing', current_period_end: '2026-10-01T00:00:00.000Z'
    })).toBeNull()
    expect(providerPaidThroughEnd({
      id: 'sub_active', status: 'active', current_period_end: '2026-10-01T00:00:00.000Z'
    })?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('rejects malformed checkout, subscription, and webhook payloads', () => {
    expect(bachsCheckoutSessionSchema.safeParse(checkout).success).toBe(true)
    expect(bachsCheckoutSessionSchema.safeParse({ ...checkout, amount: 9 }).success).toBe(false)
    expect(bachsSubscriptionSchema.safeParse({
      id: 'sub_123', status: 'active', current_period_end: '2026-10-01T00:00:00.000Z',
      metadata: { workspaceId: 'workspace', interval: 'monthly', perchPlan: 'workspace_pro', invoiceReference: 'invoice_123' },
      product: { id: 'product_123', metadata: { perch_plan: 'workspace_pro_monthly' } }
    }).success).toBe(true)
    expect(bachsSubscriptionSchema.safeParse({ id: 'sub_123', status: 'unexpected' }).success).toBe(false)
    expect(bachsWebhookEventSchema.safeParse({ id: '', type: 'invoice.paid' }).success).toBe(false)
  })
})

describe('Bachs webhook verification', () => {
  it('accepts the signed raw body and rejects tampering', () => {
    const secret = 'whsec_test'
    const body = '{"id":"evt_1","type":"invoice.paid"}'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
    expect(verifyBachsWebhookSignature(body, timestamp, signature, secret)).toBe(true)
    expect(verifyBachsWebhookSignature(`${body} `, timestamp, signature, secret)).toBe(false)
  })

  it('rejects replayed and malformed signatures', () => {
    const stale = String(Math.floor(Date.now() / 1000) - 301)
    expect(verifyBachsWebhookSignature('{}', stale, 'invalid', 'whsec_test')).toBe(false)
    expect(verifyBachsWebhookSignature('{}', 'nope', 'invalid', 'whsec_test')).toBe(false)
  })
})

describe('Bachs environment boundary', () => {
  it('fails closed for incomplete or mismatched credentials', () => {
    vi.stubEnv('BACHS_ENV', '')
    vi.stubEnv('BACHS_SECRET_KEY', '')
    vi.stubEnv('BACHS_WEBHOOK_SECRET', '')
    Object.assign(globalThis, { useRuntimeConfig: () => ({ bachsEnvironment: '', bachsSecretKey: '', bachsWebhookSecret: '' }) })
    expect(bachsConfigured()).toBe(false)
    expect(bachsConfigurationError()).toContain('not configured')

    Object.assign(globalThis, {
      useRuntimeConfig: () => ({ bachsEnvironment: 'live', bachsSecretKey: 'sk_sandbox_example', bachsWebhookSecret: 'whsec_example' })
    })
    expect(bachsConfigured()).toBe(false)
    expect(bachsConfigurationError()).toContain('do not match')

    Object.assign(globalThis, {
      useRuntimeConfig: () => ({ bachsEnvironment: 'sandbox', bachsSecretKey: 'sk_sandbox_example', bachsWebhookSecret: 'whsec_example' })
    })
    expect(bachsConfigured()).toBe(true)
  })

  it('only permits Bachs HTTPS checkout URLs', () => {
    expect(isApprovedBachsCheckoutUrl('https://checkout.bachs.io/session/123')).toBe(true)
    expect(isApprovedBachsCheckoutUrl('http://checkout.bachs.io/session/123')).toBe(false)
    expect(isApprovedBachsCheckoutUrl('https://checkout.bachs.io.evil.example/session/123')).toBe(false)
  })

  it('retries only bounded canonical reads after transient provider failures', async () => {
    Object.assign(globalThis, {
      useRuntimeConfig: () => ({
        bachsEnvironment: 'sandbox',
        bachsSecretKey: 'sk_sandbox_example',
        bachsWebhookSecret: 'whsec_example'
      })
    })
    const checkout = {
      checkout_id: 'checkout_retry',
      status: 'open',
      payment_status: 'processing',
      amount: '9.00',
      currency: 'USD',
      reference: 'invoice_retry',
      charge: null
    }
    const provider = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(checkout), { status: 200 }))
    vi.stubGlobal('fetch', provider)

    await expect(getBachsCheckoutSession('checkout_retry')).resolves.toMatchObject({ checkout_id: 'checkout_retry' })
    expect(provider).toHaveBeenCalledTimes(3)
    vi.unstubAllGlobals()
  })

  it('sends a stable idempotency key when canceling a subscription', async () => {
    Object.assign(globalThis, {
      useRuntimeConfig: () => ({
        bachsEnvironment: 'sandbox',
        bachsSecretKey: 'sk_sandbox_example',
        bachsWebhookSecret: 'whsec_example'
      })
    })
    const provider = vi.fn(async () => new Response(JSON.stringify({
      id: 'subscription_123',
      status: 'active',
      cancel_at_period_end: true,
      metadata: {
        workspaceId: 'workspace_123',
        invoiceReference: 'invoice_123',
        interval: 'monthly',
        perchPlan: 'workspace_pro'
      },
      product: { id: 'product_123', metadata: { perch_plan: 'workspace_pro_monthly' } }
    }), { status: 200 }))
    vi.stubGlobal('fetch', provider)

    await cancelBachsSubscription('subscription_123', 'perch-cancel-workspace_123-subscription_123')
    expect(provider).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          'Idempotency-Key': 'perch-cancel-workspace_123-subscription_123'
        })
      })
    )
    vi.unstubAllGlobals()
  })
})

describe('unanswered reminder timing', () => {
  it('clamps downgraded workspaces to the Free reminder settings', () => {
    expect(effectiveReminderSettings({ delayMinutes: 5, businessHoursOnly: true, isPro: false })).toEqual({
      delayMinutes: 15,
      businessHoursOnly: false
    })
  })
  it('becomes due at the configured threshold', () => {
    const sentAt = new Date('2026-09-01T10:00:00Z')
    expect(reminderIsDue(sentAt, 15, new Date('2026-09-01T10:14:59Z'))).toBe(false)
    expect(reminderIsDue(sentAt, 15, new Date('2026-09-01T10:15:00Z'))).toBe(true)
  })

  it('backs off retries without exceeding six hours', () => {
    const now = new Date('2026-09-01T10:00:00Z')
    expect(reminderRetryAt(1, now).toISOString()).toBe('2026-09-01T10:05:00.000Z')
    expect(reminderRetryAt(20, now).toISOString()).toBe('2026-09-01T16:00:00.000Z')
  })
})
