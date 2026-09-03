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

  let rawPayload: unknown
  try {
    rawPayload = JSON.parse(rawBody)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Malformed webhook body' })
  }
  const parsedPayload = bachsWebhookEventSchema.safeParse(rawPayload)
  if (!parsedPayload.success) throw createError({ statusCode: 400, statusMessage: 'Invalid webhook payload' })
  const payload = parsedPayload.data
  const eventType = payload.type
  if (SUBSCRIPTION_EVENTS.has(eventType) && !payload.data?.id) {
    throw createError({ statusCode: 400, statusMessage: 'Subscription webhook is missing its resource ID' })
  }
  if (PAID_EVENTS.has(eventType) && !payload.data?.checkout_id && !payload.data?.reference) {
    throw createError({ statusCode: 400, statusMessage: 'Payment webhook is missing its checkout identity' })
  }
  if (FAILED_EVENTS.has(eventType) && !payload.data?.reference) {
    throw createError({ statusCode: 400, statusMessage: 'Failed-payment webhook is missing its invoice reference' })
  }
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
      const applied = await reconcileWorkspaceSubscriptionEvent(payload.data.id)
      result = { received: true, ...applied }
    } else if (PAID_EVENTS.has(eventType)) {
      const applied = await confirmWorkspaceInvoiceFromCheckout({
        checkoutId: payload.data?.checkout_id,
        reference: payload.data?.reference
      })
      if (!applied.applied && applied.reason === 'provider-pending') {
        throw createError({ statusCode: 503, statusMessage: 'Payment confirmation is still pending.' })
      }
      result = { received: true, ...applied }
    } else if (payload.data?.reference && FAILED_EVENTS.has(eventType)) {
      const applied = await confirmWorkspaceInvoiceFromCheckout({ reference: payload.data.reference })
      if (!applied.applied && applied.reason === 'provider-pending') {
        throw createError({ statusCode: 503, statusMessage: 'Payment state is still pending.' })
      }
      result = { received: true, ...applied }
    } else {
      result = { received: true, ignored: eventType }
    }
    await requireBillingWebhookFinish(
      claim.delivery.id,
      claim.claimToken!,
      'ignored' in result ? 'ignored' : 'completed'
    )
    return result
  } catch (error) {
    await failBillingWebhook(claim.delivery.id, claim.claimToken!, error)
    throw createError({ statusCode: 500, statusMessage: 'Webhook processing failed' })
  }
})
