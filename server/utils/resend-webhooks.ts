import { and, eq, inArray, ne, sql, visitorEmailSuppressions, visitorReplyDeliveries } from '@perch/db'
import type { H3Event } from 'h3'
import { Webhook } from 'svix'
import { z } from 'zod'

const resendEnvelopeSchema = z.object({
  type: z.string().min(1).max(100),
  data: z.unknown().optional()
}).passthrough()

const suppressibleResendEventSchema = z.object({
  type: z.enum(['email.bounced', 'email.complained']),
  data: z.object({
    email_id: z.string().min(1).max(255)
  }).passthrough()
}).passthrough()

export interface ResendWebhookHeaders {
  id: string | undefined
  timestamp: string | undefined
  signature: string | undefined
}

export interface ResendWebhookEvent {
  type: string
  providerMessageId: string | null
  suppressionReason: 'bounce' | 'complaint' | null
}

function runtimeConfig(event?: H3Event) {
  return event ? useRuntimeConfig(event) : useRuntimeConfig()
}

export function requireResendWebhookSecret(event?: H3Event): string {
  const secret = String(runtimeConfig(event).resendWebhookSecret || process.env.RESEND_WEBHOOK_SECRET || '').trim()
  if (secret.length >= 32) return secret
  throw new Error('resend_webhook_secret_missing')
}

/** Verify the untouched body before parsing any provider-controlled values. */
export function verifyResendWebhook(
  rawBody: string,
  headers: ResendWebhookHeaders,
  secret: string
): ResendWebhookEvent {
  if (!headers.id || !headers.timestamp || !headers.signature) {
    throw new Error('resend_webhook_headers_missing')
  }
  new Webhook(secret).verify(rawBody, {
    'svix-id': headers.id,
    'svix-timestamp': headers.timestamp,
    'svix-signature': headers.signature
  })
  let verified: unknown
  try {
    verified = JSON.parse(rawBody)
  } catch {
    throw new Error('resend_webhook_payload_invalid')
  }
  const envelope = resendEnvelopeSchema.safeParse(verified)
  if (!envelope.success) throw new Error('resend_webhook_payload_invalid')
  if (envelope.data.type !== 'email.bounced' && envelope.data.type !== 'email.complained') {
    return { type: envelope.data.type, providerMessageId: null, suppressionReason: null }
  }
  const event = suppressibleResendEventSchema.safeParse(verified)
  if (!event.success) throw new Error('resend_webhook_payload_invalid')
  return {
    type: event.data.type,
    providerMessageId: event.data.data.email_id,
    suppressionReason: event.data.type === 'email.complained' ? 'complaint' : 'bounce'
  }
}

/**
 * Suppress only the workspace/address that Perch previously sent this provider
 * message to. The signed payload's visible recipient is not trusted as the
 * database lookup key.
 */
export async function applyResendVisitorSuppression(
  providerMessageId: string,
  reason: 'bounce' | 'complaint'
) {
  return useDb().transaction(async (tx) => {
    const deliveries = await tx.select({
      workspaceId: visitorReplyDeliveries.workspaceId,
      emailHash: visitorReplyDeliveries.recipientEmailHash
    }).from(visitorReplyDeliveries).where(and(
      eq(visitorReplyDeliveries.providerMessageId, providerMessageId),
      eq(visitorReplyDeliveries.status, 'sent')
    ))

    const targets = new Map(deliveries.map(row => [`${row.workspaceId}:${row.emailHash}`, row]))
    let canceled = 0
    for (const target of targets.values()) {
      await tx.insert(visitorEmailSuppressions).values({
        workspaceId: target.workspaceId,
        emailHash: target.emailHash,
        reason
      }).onConflictDoNothing()

      // Provider abuse signals are stronger than a visitor-controlled opt-out.
      // Complaint remains the strongest reason if duplicate events arrive out of order.
      if (reason === 'complaint') {
        await tx.update(visitorEmailSuppressions).set({ reason: 'complaint' }).where(and(
          eq(visitorEmailSuppressions.workspaceId, target.workspaceId),
          eq(visitorEmailSuppressions.emailHash, target.emailHash),
          ne(visitorEmailSuppressions.reason, 'complaint')
        ))
      } else {
        await tx.update(visitorEmailSuppressions).set({ reason: 'bounce' }).where(and(
          eq(visitorEmailSuppressions.workspaceId, target.workspaceId),
          eq(visitorEmailSuppressions.emailHash, target.emailHash),
          eq(visitorEmailSuppressions.reason, 'unsubscribe')
        ))
      }

      const canceledRows = await tx.update(visitorReplyDeliveries).set({
        status: 'canceled',
        cancelReason: `suppressed_${reason}`,
        lockedAt: null,
        updatedAt: sql`now()`
      }).where(and(
        eq(visitorReplyDeliveries.workspaceId, target.workspaceId),
        eq(visitorReplyDeliveries.recipientEmailHash, target.emailHash),
        inArray(visitorReplyDeliveries.status, ['pending', 'failed', 'processing'])
      )).returning({ id: visitorReplyDeliveries.id })
      canceled += canceledRows.length
    }

    return { matched: targets.size, canceled }
  })
}
