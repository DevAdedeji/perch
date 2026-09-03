import { and, eq, inArray, lte, ne, resendSuppressionEvents, sql, visitorEmailSuppressions, visitorReplyDeliveries } from '@perch/db'
import type { Database } from '@perch/db'
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

const RESEND_SUPPRESSION_MAX_ATTEMPTS = 6
const RESEND_SUPPRESSION_SWEEP_LIMIT = 20
const RESEND_SUPPRESSION_RETRY_MS = [10_000, 30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000]
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

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
async function suppressMatchedDelivery(
  tx: Transaction,
  providerMessageId: string,
  reason: 'bounce' | 'complaint'
) {
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
}

async function markSuppressionProcessed(
  tx: Transaction,
  providerMessageId: string,
  now: Date
) {
  await tx.update(resendSuppressionEvents).set({
    status: 'processed',
    processedAt: now,
    updatedAt: sql`now()`
  }).where(eq(resendSuppressionEvents.providerMessageId, providerMessageId))
}

export async function applyResendVisitorSuppression(
  providerMessageId: string,
  reason: 'bounce' | 'complaint',
  db: Database = useDb(),
  now = new Date()
) {
  return db.transaction(async (tx) => {
    await tx.insert(resendSuppressionEvents).values({
      providerMessageId,
      reason,
      nextAttemptAt: now
    }).onConflictDoUpdate({
      target: resendSuppressionEvents.providerMessageId,
      set: {
        reason: sql`case when ${resendSuppressionEvents.reason} = 'complaint' or ${reason} = 'complaint' then 'complaint' else 'bounce' end`,
        status: sql`case when ${resendSuppressionEvents.status} = 'dead_letter' then ${resendSuppressionEvents.status} else 'pending' end`,
        nextAttemptAt: now,
        updatedAt: sql`now()`
      }
    })
    const event = await tx.query.resendSuppressionEvents.findFirst({
      where: eq(resendSuppressionEvents.providerMessageId, providerMessageId)
    })
    const result = await suppressMatchedDelivery(tx, providerMessageId, event?.reason ?? reason)
    if (result.matched) await markSuppressionProcessed(tx, providerMessageId, now)
    return result
  })
}

export async function reconcileResendSuppressionForMessage(
  providerMessageId: string,
  db: Database = useDb(),
  now = new Date()
) {
  const event = await db.query.resendSuppressionEvents.findFirst({
    where: eq(resendSuppressionEvents.providerMessageId, providerMessageId)
  })
  if (!event || event.status === 'processed') return { matched: 0, canceled: 0 }
  return applyResendVisitorSuppression(providerMessageId, event.reason, db, now)
}

function suppressionRetryAt(attempt: number, now: Date) {
  const delay = RESEND_SUPPRESSION_RETRY_MS[Math.min(attempt - 1, RESEND_SUPPRESSION_RETRY_MS.length - 1)]!
  return new Date(now.getTime() + delay)
}

export async function runResendSuppressionSweep(
  options: { db?: Database, now?: Date } = {}
) {
  const db = options.db ?? useDb()
  const now = options.now ?? new Date()
  const candidates = await db.select({ providerMessageId: resendSuppressionEvents.providerMessageId })
    .from(resendSuppressionEvents).where(and(
      eq(resendSuppressionEvents.status, 'pending'),
      lte(resendSuppressionEvents.nextAttemptAt, now)
    )).limit(RESEND_SUPPRESSION_SWEEP_LIMIT)

  let processed = 0
  for (const candidate of candidates) {
    const handled = await db.transaction(async (tx) => {
      const [event] = await tx.select().from(resendSuppressionEvents).where(and(
        eq(resendSuppressionEvents.providerMessageId, candidate.providerMessageId),
        eq(resendSuppressionEvents.status, 'pending'),
        lte(resendSuppressionEvents.nextAttemptAt, now)
      )).limit(1).for('update', { skipLocked: true })
      if (!event) return false
      const result = await suppressMatchedDelivery(tx, event.providerMessageId, event.reason)
      if (result.matched) {
        await markSuppressionProcessed(tx, event.providerMessageId, now)
        return true
      }
      const attempts = Math.min(event.attempts + 1, RESEND_SUPPRESSION_MAX_ATTEMPTS)
      await tx.update(resendSuppressionEvents).set({
        status: attempts >= RESEND_SUPPRESSION_MAX_ATTEMPTS ? 'dead_letter' : 'pending',
        attempts,
        nextAttemptAt: suppressionRetryAt(attempts, now),
        updatedAt: sql`now()`
      }).where(eq(resendSuppressionEvents.providerMessageId, event.providerMessageId))
      return true
    })
    if (handled) processed++
  }

  return { processed }
}
