import { createHmac, timingSafeEqual } from 'node:crypto'
import type { BillingInterval } from '@perch/shared'
import { PERCH_PRO_PLAN, proPriceCents, toDecimalString } from '@perch/shared'

const SANDBOX_API = 'https://sandbox-api.bachs.io/v1'
const LIVE_API = 'https://api.bachs.io/v1'
const WEBHOOK_TOLERANCE_SECONDS = 300
const REQUEST_TIMEOUT_MS = 15_000
const productCache = new Map<BillingInterval, string>()

function configuredSecretKey() {
  const config = useRuntimeConfig()
  return String(config.bachsSecretKey || process.env.BACHS_SECRET_KEY || '')
}

export function bachsConfigured() {
  return Boolean(configuredSecretKey())
}

function secretKey() {
  const key = configuredSecretKey()
  if (!key) throw createError({ statusCode: 503, statusMessage: 'Billing is not configured on this environment yet.' })
  return key
}

function apiBase() {
  return secretKey().startsWith('sk_sandbox_') ? SANDBOX_API : LIVE_API
}

interface BachsRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
  query?: Record<string, string | number | undefined>
  idempotencyKey?: string
}

export async function bachsFetch<T>(path: string, options: BachsRequest = {}): Promise<T> {
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
    const detail = payload?.detail ?? payload?.message ?? `Bachs request failed (${response.status})`
    throw createError({
      statusCode: response.status === 422 ? 502 : response.status,
      statusMessage: String(detail)
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
  const secret = secretOverride || String(useRuntimeConfig().bachsWebhookSecret || process.env.BACHS_WEBHOOK_SECRET || '')
  if (!secret || !timestampHeader || !signatureHeader) return false
  const timestamp = Number.parseInt(timestampHeader, 10)
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')
  const expectedBytes = Buffer.from(expected, 'utf8')
  const suppliedBytes = Buffer.from(signatureHeader, 'utf8')
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
}

interface BachsProduct {
  id: string
  metadata?: Record<string, string> | null
}

interface ProductPage {
  items?: BachsProduct[]
  pagination?: { has_more?: boolean, next_cursor?: string | null }
}

async function findProduct(planKey: string) {
  let cursor: string | undefined
  do {
    const page = await bachsFetch<ProductPage>('/products', { query: { limit: 100, cursor } })
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
  const product = await bachsFetch<BachsProduct>('/products', {
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
  })
  productCache.set(interval, product.id)
  return product.id
}

export interface BachsCheckoutSession {
  checkout_id: string
  checkout_url?: string
  reference?: string | null
}

export interface BachsSubscription {
  id: string
  status: 'trialing' | 'active' | 'past_due' | 'unpaid' | 'paused' | 'canceled'
  current_period_end?: string | null
  next_billed_at?: string | null
  cancel_at_period_end?: boolean
  metadata?: Record<string, string> | null
  product?: BachsProduct | null
}

export function createSubscriptionCheckout(input: {
  productId: string
  reference: string
  customer: { email: string, name: string }
  successUrl: string
  cancelUrl: string
  metadata: Record<string, string>
}) {
  return bachsFetch<BachsCheckoutSession>('/checkout-sessions', {
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
  })
}

export function cancelBachsSubscription(subscriptionId: string) {
  return bachsFetch<BachsSubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'DELETE',
    body: { cancel_at_period_end: true }
  })
}
