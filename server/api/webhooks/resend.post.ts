import { applyResendVisitorSuppression, requireResendWebhookSecret, verifyResendWebhook } from '../../utils/resend-webhooks'

export default defineEventHandler(async (event) => {
  const rawBody = await readRawBody(event, 'utf8')
  if (!rawBody) throw createError({ statusCode: 400, statusMessage: 'Empty webhook body' })

  let webhook
  try {
    webhook = verifyResendWebhook(rawBody, {
      id: getHeader(event, 'svix-id'),
      timestamp: getHeader(event, 'svix-timestamp'),
      signature: getHeader(event, 'svix-signature')
    }, requireResendWebhookSecret(event))
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid webhook' })
  }

  if (!webhook.providerMessageId || !webhook.suppressionReason) {
    return { received: true, ignored: webhook.type }
  }

  try {
    const result = await applyResendVisitorSuppression(webhook.providerMessageId, webhook.suppressionReason)
    return { received: true, ...result }
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Webhook processing is temporarily unavailable' })
  }
})
