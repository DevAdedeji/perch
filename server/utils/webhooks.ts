import { createHmac, randomUUID } from 'node:crypto'
import { and, desc, eq, sql, webhookDeliveries, webhookEndpoints } from '@perch/db'
import type { WebhookEndpoint } from '@perch/db'

/**
 * Outbound webhooks: HMAC-signed POSTs to customer endpoints on conversation
 * events. Delivery is fire-and-forget with retries — a customer's slow server
 * must never slow down (or fail) a chat request. Receivers verify with:
 *   HMAC-SHA256(secret, `${t}.${rawBody}`) === v1   (from X-Perch-Signature "t=…,v1=…")
 */

export const WEBHOOK_EVENTS = ['conversation.created', 'message.created', 'conversation.resolved'] as const
export type WebhookEventName = typeof WEBHOOK_EVENTS[number]

const TIMEOUT_MS = 5_000
// attempt delays: immediate, then 5s and 25s backoff
const RETRY_DELAYS_MS = [0, 5_000, 25_000]
const KEEP_DELIVERIES = 50

/* pure helpers (unit-tested in test/webhooks.test.ts) */

/** Sign a payload Stripe-style: hex HMAC-SHA256 over `${timestamp}.${body}`. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

/**
 * Basic SSRF guard for endpoint URLs: http(s) only, no loopback/private/link-
 * local hosts. Hostname-level only — DNS-rebinding is out of scope for v1.
 */
export function isSafeWebhookUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  const host = u.hostname.toLowerCase()
  if (!host || host === 'localhost' || host === '0.0.0.0' || host === '[::1]' || host === '::1') return false
  if (host.endsWith('.local') || host.endsWith('.internal')) return false
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
  return true
}

/* endpoint cache (dispatch runs on hot message paths) */

interface CacheEntry { at: number, endpoints: WebhookEndpoint[] }

const CACHE_TTL = 30_000
const g = globalThis as unknown as { __perchWebhookCache?: Map<string, CacheEntry> }
const cache: Map<string, CacheEntry> = (g.__perchWebhookCache ??= new Map())

async function getEndpoints(workspaceId: string): Promise<WebhookEndpoint[]> {
  const hit = cache.get(workspaceId)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.endpoints
  const endpoints = await useDb().query.webhookEndpoints.findMany({
    where: and(eq(webhookEndpoints.workspaceId, workspaceId), eq(webhookEndpoints.enabled, true))
  })
  cache.set(workspaceId, { at: Date.now(), endpoints })
  return endpoints
}

/** Call after any webhook CRUD so dispatch sees the change immediately. */
export function invalidateWebhookCache(workspaceId: string) {
  cache.delete(workspaceId)
}

/* delivery */

export interface DeliveryResult {
  ok: boolean
  http_status: number | null
  duration_ms: number
  error: string | null
}

/** One signed POST to one endpoint; records a `webhook_deliveries` row. */
export async function deliverOnce(
  endpoint: WebhookEndpoint,
  event: string,
  body: string,
  attempt: number
): Promise<DeliveryResult> {
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = signWebhook(endpoint.secret, timestamp, body)
  const started = Date.now()
  let ok = false
  let httpStatus: number | null
  let error: string | null = null

  try {
    const res = await $fetch.raw(endpoint.url, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-perch-event': event,
        'x-perch-signature': `t=${timestamp},v1=${signature}`
      },
      timeout: TIMEOUT_MS,
      retry: 0,
      // the response body is the customer's business, not ours
      responseType: 'text'
    })
    httpStatus = res.status
    ok = true
  } catch (e) {
    const fe = e as { response?: { status?: number }, message?: string }
    httpStatus = fe.response?.status ?? null
    error = (fe.message ?? 'delivery failed').slice(0, 500)
  }
  const durationMs = Date.now() - started

  try {
    const db = useDb()
    await db.insert(webhookDeliveries).values({
      endpointId: endpoint.id,
      event,
      ok,
      httpStatus,
      durationMs,
      attempt,
      error
    })
    // keep only the newest N rows per endpoint
    await db.execute(sql`
      delete from webhook_deliveries
      where endpoint_id = ${endpoint.id}
        and id not in (
          select id from webhook_deliveries
          where endpoint_id = ${endpoint.id}
          order by created_at desc
          limit ${KEEP_DELIVERIES}
        )
    `)
  } catch (e) {
    console.error('[webhooks] could not record delivery:', e)
  }

  return { ok, http_status: httpStatus, duration_ms: durationMs, error }
}

async function deliverWithRetries(endpoint: WebhookEndpoint, event: string, body: string) {
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt - 1]!
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    const result = await deliverOnce(endpoint, event, body, attempt)
    if (result.ok) return
  }
}

/** Build the wire envelope (also used by the "Send test" endpoint). */
export function webhookEnvelope(event: string, data: Record<string, unknown>): string {
  return JSON.stringify({ id: randomUUID(), event, created_at: new Date().toISOString(), data })
}

/**
 * Fan an event out to every enabled endpoint subscribed to it. Fire-and-forget:
 * returns immediately, never throws into the caller's request path.
 */
export function dispatchWebhooks(workspaceId: string, event: WebhookEventName, data: Record<string, unknown>) {
  void (async () => {
    const endpoints = (await getEndpoints(workspaceId)).filter(e => e.events.includes(event))
    if (!endpoints.length) return
    const body = webhookEnvelope(event, data)
    await Promise.all(endpoints.map(e => deliverWithRetries(e, event, body)))
  })().catch(e => console.error('[webhooks] dispatch failed:', e))
}

/* deliveries listing (admin UI) */

export async function recentDeliveries(endpointId: string, limit = 25) {
  const rows = await useDb().query.webhookDeliveries.findMany({
    where: eq(webhookDeliveries.endpointId, endpointId),
    orderBy: [desc(webhookDeliveries.createdAt)],
    limit
  })
  return rows.map(d => ({
    id: d.id,
    event: d.event,
    ok: d.ok,
    http_status: d.httpStatus,
    duration_ms: d.durationMs,
    attempt: d.attempt,
    error: d.error,
    created_at: d.createdAt.toISOString()
  }))
}
