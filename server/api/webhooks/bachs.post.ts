import type { BachsSubscription } from '../../utils/bachs'

interface BachsEvent {
  id?: string
  type?: string
  data?: {
    id?: string
    reference?: string
    charge_id?: string | null
    metadata?: Record<string, string>
    status?: string
    current_period_end?: string | null
    next_billed_at?: string | null
    cancel_at_period_end?: boolean
    product?: { id: string, metadata?: Record<string, string> | null } | null
  }
}

const PAID_EVENTS = new Set(['collection.succeeded', 'checkout.completed', 'invoice.paid'])
const FAILED_EVENTS = new Set(['collection.failed', 'checkout.expired', 'invoice.payment_failed'])
const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted'
])

export default defineEventHandler(async (event) => {
  const rawBody = await readRawBody(event, 'utf8')
  if (!rawBody) throw createError({ statusCode: 400, statusMessage: 'Empty webhook body' })
  if (!verifyBachsWebhookSignature(
    rawBody,
    getHeader(event, 'x-bachs-timestamp'),
    getHeader(event, 'x-bachs-signature')
  )) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid webhook signature' })
  }

  let payload: BachsEvent
  try {
    payload = JSON.parse(rawBody) as BachsEvent
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Malformed webhook body' })
  }
  if (!payload.id) throw createError({ statusCode: 400, statusMessage: 'Webhook is missing an event id' })
  const eventType = payload.type ?? 'unknown'
  const claim = await claimBillingWebhook(payload.id, eventType)
  if (!claim.shouldProcess) {
    if (claim.delivery.status === 'processing') {
      throw createError({ statusCode: 503, statusMessage: 'Webhook is still processing; retry shortly.' })
    }
    return { received: true, duplicate: true, status: claim.delivery.status }
  }

  try {
    let result: Record<string, unknown>
    if (SUBSCRIPTION_EVENTS.has(eventType) && payload.data?.id) {
      const applied = await applyWorkspaceSubscriptionState(payload.data as BachsSubscription)
      result = { received: true, ...applied }
    } else if (payload.data?.reference && PAID_EVENTS.has(eventType)) {
      const applied = await markWorkspaceInvoicePaid(payload.data.reference, payload.data.charge_id)
      result = { received: true, ...applied }
    } else if (payload.data?.reference && FAILED_EVENTS.has(eventType)) {
      const applied = await markWorkspaceInvoiceFailed(payload.data.reference, eventType)
      result = { received: true, applied }
    } else {
      result = { received: true, ignored: eventType }
    }
    await finishBillingWebhook(claim.delivery.id, 'ignored' in result ? 'ignored' : 'completed')
    return result
  } catch (error) {
    await failBillingWebhook(claim.delivery.id, error)
    throw createError({ statusCode: 500, statusMessage: 'Webhook processing failed' })
  }
})
