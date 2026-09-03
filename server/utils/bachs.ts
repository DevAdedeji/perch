import { createHmac, timingSafeEqual } from 'node:crypto'
import type { BillingInterval } from '@perch/shared'
import { PERCH_PRO_PLAN, proPriceCents, toDecimalString } from '@perch/shared'
import { z } from 'zod'

const SANDBOX_API = 'https://sandbox-api.bachs.io/v1'
const LIVE_API = 'https://api.bachs.io/v1'
const WEBHOOK_TOLERANCE_SECONDS = 300
const REQUEST_TIMEOUT_MS = 15_000
const productCache = new Map<BillingInterval, string>()

const bachsEnvironmentSchema = z.enum(['sandbox', 'live'])
const providerDateSchema = z.string().refine(value => !Number.isNaN(Date.parse(value)), 'Invalid provider date')
const providerMetadataSchema = z.record(z.string(), z.string()).nullable().optional()
const providerProductSchema = z.object({
  id: z.string().min(1),
  metadata: providerMetadataSchema
}).passthrough()

const checkoutCreatedSchema = z.object({
  checkout_id: z.string().min(1),
  checkout_url: z.string().url().optional(),
  reference: z.string().nullable().optional()
}).passthrough()

export const bachsCheckoutSessionSchema = z.object({
  checkout_id: z.string().min(1),
  checkout_url: z.string().url().optional(),
  status: z.enum(['open', 'completed', 'expired', 'cancelled']),
  payment_status: z.enum([
    'requires_payment_method', 'requires_confirmation', 'requires_action', 'processing',
    'succeeded', 'failed', 'canceled'
  ]).nullable().optional(),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/),
  currency: z.string().min(3).max(8),
  reference: z.string().nullable(),
  charge: z.object({
    payment_id: z.string().min(1),
    status: z.enum([
      'created', 'processing', 'succeeded', 'accepted', 'failed', 'expired',
      'cancelled', 'refunded', 'partially_refunded', 'underpaid', 'overpaid'
    ]),
    amount: z.string().regex(/^\d+(?:\.\d+)?$/),
    amount_paid: z.string().regex(/^\d+(?:\.\d+)?$/).nullable().optional(),
    currency: z.string().min(3).max(8)
  }).nullable().optional()
}).passthrough()

export const bachsSubscriptionSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled']),
  current_period_end: providerDateSchema.nullable().optional(),
  next_billed_at: providerDateSchema.nullable().optional(),
  trial_end: providerDateSchema.nullable().optional(),
  cancel_at_period_end: z.boolean().optional(),
  metadata: providerMetadataSchema,
  product: providerProductSchema.nullable().optional()
}).passthrough()

export const bachsWebhookEventSchema = z.object({
  id: z.string().min(1).max(500),
  type: z.string().min(1).max(200),
  data: z.object({
    id: z.string().min(1).optional(),
    reference: z.string().min(1).max(500).optional(),
    checkout_id: z.string().min(1).max(500).nullable().optional(),
    charge_id: z.string().min(1).max(500).nullable().optional()
  }).passthrough().optional()
}).passthrough()

export type BachsCheckoutSession = z.infer<typeof bachsCheckoutSessionSchema>
export type BachsSubscription = z.infer<typeof bachsSubscriptionSchema>
export type BachsWebhookEvent = z.infer<typeof bachsWebhookEventSchema>

function configuredSecretKey() {
  const config = useRuntimeConfig()
  return String(config.bachsSecretKey || process.env.BACHS_SECRET_KEY || '')
}

function configuredWebhookSecret() {
  const config = useRuntimeConfig()
  return String(config.bachsWebhookSecret || process.env.BACHS_WEBHOOK_SECRET || '')
}

function configuredEnvironment() {
  const config = useRuntimeConfig()
  return String(config.bachsEnvironment || process.env.BACHS_ENV || '')
}

export function bachsConfigurationError(): string | null {
  const key = configuredSecretKey()
  const webhookSecret = configuredWebhookSecret()
  const parsedEnvironment = bachsEnvironmentSchema.safeParse(configuredEnvironment())
  if (!key && !webhookSecret && !configuredEnvironment()) return 'Billing is not configured on this environment yet.'
  if (!key || !webhookSecret || !parsedEnvironment.success) return 'Billing configuration is incomplete.'
  const sandboxKey = key.startsWith('sk_sandbox_')
  if ((parsedEnvironment.data === 'sandbox') !== sandboxKey) return 'Billing credentials do not match the configured environment.'
  return null
}

export function bachsConfigured() {
  return bachsConfigurationError() === null
}

function secretKey() {
  const configurationError = bachsConfigurationError()
  if (configurationError) throw createError({ statusCode: 503, statusMessage: configurationError })
  const key = configuredSecretKey()
  return key
}

function apiBase() {
  return configuredEnvironment() === 'sandbox' ? SANDBOX_API : LIVE_API
}

interface BachsRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
  query?: Record<string, string | number | undefined>
  idempotencyKey?: string
}

async function bachsFetch<T>(path: string, options: BachsRequest = {}): Promise<T> {
  const url = new URL(`${apiBase()}${path}`)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'Authorization': `Bearer ${secretKey()}`,
        'Content-Type': 'application/json',
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    })
    const text = await response.text()
    const payload = text ? safeJson(text) : null
    if (response.ok) return payload as T
    throw createError({
      statusCode: response.status >= 500 ? 503 : 502,
      statusMessage: 'Billing provider request failed. Please try again.'
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw createError({ statusCode: 503, statusMessage: 'Bachs took too long to respond. Please try again.' })
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function parseProviderResponse<T>(schema: z.ZodType<T>, payload: unknown, resource: string): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw createError({ statusCode: 502, statusMessage: `Bachs returned an invalid ${resource}.` })
  }
  return parsed.data
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

export function verifyBachsWebhookSignature(
  rawBody: string,
  timestampHeader?: string,
  signatureHeader?: string,
  secretOverride?: string
) {
  if (!secretOverride && !bachsConfigured()) return false
  const secret = secretOverride || configuredWebhookSecret()
  if (!secret || !timestampHeader || !signatureHeader) return false
  const timestamp = Number.parseInt(timestampHeader, 10)
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')
  const expectedBytes = Buffer.from(expected, 'utf8')
  const suppliedBytes = Buffer.from(signatureHeader, 'utf8')
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
}

export function isApprovedBachsCheckoutUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'checkout.bachs.io' && !url.username && !url.password
  } catch {
    return false
  }
}

interface ProductPage {
  items?: Array<z.infer<typeof providerProductSchema>>
  pagination?: { has_more?: boolean, next_cursor?: string | null }
}

const productPageSchema = z.object({
  items: z.array(providerProductSchema).optional(),
  pagination: z.object({
    has_more: z.boolean().optional(),
    next_cursor: z.string().nullable().optional()
  }).optional()
}).passthrough()

async function findProduct(planKey: string) {
  let cursor: string | undefined
  do {
    const page = parseProviderResponse(
      productPageSchema,
      await bachsFetch<unknown>('/products', { query: { limit: 100, cursor } }),
      'product list'
    ) as ProductPage
    const match = (page.items ?? []).find(product => product.metadata?.perch_plan === planKey)
    if (match) return match
    cursor = page.pagination?.has_more ? page.pagination.next_cursor ?? undefined : undefined
  } while (cursor)
  return null
}

export async function ensurePerchProProduct(interval: BillingInterval) {
  const cached = productCache.get(interval)
  if (cached) return cached
  const planKey = `workspace_pro_${interval}`
  const existing = await findProduct(planKey)
  if (existing) {
    productCache.set(interval, existing.id)
    return existing.id
  }
  const product = parseProviderResponse(providerProductSchema, await bachsFetch<unknown>('/products', {
    method: 'POST',
    idempotencyKey: `perch-${planKey}`,
    body: {
      name: `Perch Pro (${interval})`,
      description: 'Fast customer support chat with unlimited teammates and advanced workspace controls.',
      price: {
        currency: PERCH_PRO_PLAN.currency,
        price_type: 'fixed',
        amount: toDecimalString(proPriceCents(interval))
      },
      billing_cycle: { interval: interval === 'yearly' ? 'year' : 'month', frequency: 1 },
      metadata: { perch_plan: planKey }
    }
  }), 'product')
  productCache.set(interval, product.id)
  return product.id
}

export async function createSubscriptionCheckout(input: {
  productId: string
  reference: string
  customer: { email: string, name: string }
  successUrl: string
  cancelUrl: string
  metadata: Record<string, string>
}) {
  return parseProviderResponse(checkoutCreatedSchema, await bachsFetch<unknown>('/checkout-sessions', {
    method: 'POST',
    idempotencyKey: input.reference,
    body: {
      product_cart: [{ product_id: input.productId, quantity: 1 }],
      billing_currency: PERCH_PRO_PLAN.currency,
      customer: input.customer,
      reference: input.reference,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: input.metadata
    }
  }), 'checkout session')
}

export async function getBachsCheckoutSession(checkoutId: string) {
  return parseProviderResponse(
    bachsCheckoutSessionSchema,
    await bachsFetch<unknown>(`/checkout-sessions/${encodeURIComponent(checkoutId)}`),
    'checkout session'
  )
}

export async function getBachsSubscription(subscriptionId: string) {
  return parseProviderResponse(
    bachsSubscriptionSchema,
    await bachsFetch<unknown>(`/subscriptions/${encodeURIComponent(subscriptionId)}`),
    'subscription'
  )
}

export async function cancelBachsSubscription(subscriptionId: string, idempotencyKey?: string) {
  return parseProviderResponse(bachsSubscriptionSchema, await bachsFetch<unknown>(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'DELETE',
    body: { cancel_at_period_end: true },
    idempotencyKey
  }), 'subscription')
}
