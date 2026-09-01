import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import {
  and,
  asc,
  conversations,
  count,
  eq,
  gte,
  inArray,
  lt,
  messages,
  or,
  sql,
  visitorBlocks,
  visitorConversationReads,
  visitorEmailSuppressions,
  visitorReplyDeliveries,
  visitors,
  workspaces
} from '@perch/db'
import type { H3Event } from 'h3'
import { emailLayout, escapeHtml, sendEmailDetailed } from './email'
import type { EmailDeliveryResult, SendEmailOptions } from './email'

const MAX_ATTEMPTS = 5
const CLAIM_LIMIT = 25
const STALE_LOCK_MS = 10 * 60_000
const SESSION_SECONDS = 7 * 24 * 60 * 60
const UNSUBSCRIBE_SECONDS = 365 * 24 * 60 * 60
const REPLY_SESSION_COOKIE = 'perch-reply-session'

interface SignedReplyPayload {
  purpose: 'open' | 'unsubscribe' | 'session'
  deliveryId: string
  workspaceId?: string
  visitorRef?: string
  conversationId?: string
  exp: number
}

export interface ReplySession {
  deliveryId: string
  workspaceId: string
  visitorRef: string
  conversationId: string
  exp: number
}

export function normalizeVisitorEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function visitorEmailHash(value: string): string {
  return createHash('sha256').update(normalizeVisitorEmail(value)).digest('hex')
}

export function maskVisitorEmail(value: string): string {
  const normalized = normalizeVisitorEmail(value)
  const at = normalized.lastIndexOf('@')
  if (at <= 0) return 'your email'
  const local = normalized.slice(0, at)
  const domain = normalized.slice(at + 1)
  return `${local.slice(0, 1)}${'•'.repeat(Math.min(4, Math.max(2, local.length - 1)))}@${domain}`
}

function signature(encoded: string, secret: string) {
  return createHmac('sha256', secret).update(encoded).digest()
}

export function signReplyPayload(payload: SignedReplyPayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${signature(encoded, secret).toString('base64url')}`
}

export function verifyReplyPayload(
  token: string,
  secret: string,
  purpose: SignedReplyPayload['purpose'],
  nowSeconds = Math.floor(Date.now() / 1000)
): SignedReplyPayload | null {
  const [encoded, supplied, extra] = token.split('.')
  if (!encoded || !supplied || extra) return null
  const expected = signature(encoded, secret)
  let actual: Buffer
  try {
    actual = Buffer.from(supplied, 'base64url')
  } catch {
    return null
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedReplyPayload
    if (payload.purpose !== purpose || typeof payload.deliveryId !== 'string'
      || typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null
    return payload
  } catch {
    return null
  }
}

export function replyEmailRetryAt(attempt: number, now = new Date()) {
  const minutes = [1, 5, 30, 120, 360][Math.max(0, Math.min(4, attempt - 1))]!
  return new Date(now.getTime() + minutes * 60_000)
}

function replySecret(event?: H3Event): string {
  const configured = event ? useRuntimeConfig(event).visitorReplySecret : useRuntimeConfig().visitorReplySecret
  const secret = String(configured || process.env.VISITOR_REPLY_SECRET || '')
  if (secret.length >= 32) return secret
  if (import.meta.dev || process.env.NODE_ENV === 'test') return requireRealtimeSecret(event)
  throw new Error('VISITOR_REPLY_SECRET must be at least 32 characters')
}

export function issueReplyLinkToken(deliveryId: string, expiresAt: Date, purpose: 'open' | 'unsubscribe', event?: H3Event) {
  return signReplyPayload({ purpose, deliveryId, exp: Math.floor(expiresAt.getTime() / 1000) }, replySecret(event))
}

export function verifyReplyLinkToken(token: string, purpose: 'open' | 'unsubscribe', event?: H3Event) {
  return verifyReplyPayload(token, replySecret(event), purpose)
}

export function issueReplySession(input: Omit<ReplySession, 'exp'>, event?: H3Event): string {
  return signReplyPayload({
    purpose: 'session',
    ...input,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  }, replySecret(event))
}

export function verifyReplySession(token: string, event?: H3Event): ReplySession | null {
  const payload = verifyReplyPayload(token, replySecret(event), 'session')
  if (!payload?.workspaceId || !payload.visitorRef || !payload.conversationId) return null
  return {
    deliveryId: payload.deliveryId,
    workspaceId: payload.workspaceId,
    visitorRef: payload.visitorRef,
    conversationId: payload.conversationId,
    exp: payload.exp
  }
}

export function setReplySession(event: H3Event, session: string) {
  setCookie(event, REPLY_SESSION_COOKIE, session, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_SECONDS
  })
}

export function clearReplySession(event: H3Event) {
  deleteCookie(event, REPLY_SESSION_COOKIE, { path: '/' })
}

export async function requireReplyContinuation(event: H3Event) {
  const token = getCookie(event, REPLY_SESSION_COOKIE)
  const session = token ? verifyReplySession(token, event) : null
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Return session is invalid or expired' })

  const [context] = await useDb().select({
    delivery: visitorReplyDeliveries,
    conversation: conversations,
    visitor: visitors,
    workspace: workspaces
  }).from(visitorReplyDeliveries)
    .innerJoin(conversations, eq(conversations.id, visitorReplyDeliveries.conversationId))
    .innerJoin(visitors, eq(visitors.id, visitorReplyDeliveries.visitorRef))
    .innerJoin(workspaces, eq(workspaces.id, visitorReplyDeliveries.workspaceId))
    .where(and(
      eq(visitorReplyDeliveries.id, session.deliveryId),
      eq(visitorReplyDeliveries.workspaceId, session.workspaceId),
      eq(visitorReplyDeliveries.visitorRef, session.visitorRef),
      eq(visitorReplyDeliveries.conversationId, session.conversationId)
    )).limit(1)
  if (!context || !context.visitor.email
    || visitorEmailHash(context.visitor.email) !== context.delivery.recipientEmailHash) {
    clearReplySession(event)
    throw createError({ statusCode: 401, statusMessage: 'Return session is no longer valid' })
  }
  return { ...context, session }
}

async function claimDeliveries(now: Date) {
  return useDb().transaction(async (tx) => {
    const stale = new Date(now.getTime() - STALE_LOCK_MS)
    const rows = await tx.select().from(visitorReplyDeliveries).where(or(
      and(
        inArray(visitorReplyDeliveries.status, ['pending', 'failed']),
        lt(visitorReplyDeliveries.attempts, MAX_ATTEMPTS),
        lt(visitorReplyDeliveries.nextAttemptAt, new Date(now.getTime() + 1))
      ),
      and(
        eq(visitorReplyDeliveries.status, 'processing'),
        sql`${visitorReplyDeliveries.attempts} <= ${MAX_ATTEMPTS}`,
        lt(visitorReplyDeliveries.lockedAt, stale)
      )
    )).orderBy(asc(visitorReplyDeliveries.nextAttemptAt)).limit(CLAIM_LIMIT).for('update', { skipLocked: true })
    if (!rows.length) return []
    return tx.update(visitorReplyDeliveries).set({
      status: 'processing',
      lockedAt: now,
      attempts: sql`case when ${visitorReplyDeliveries.status} = 'processing' then ${visitorReplyDeliveries.attempts} else ${visitorReplyDeliveries.attempts} + 1 end`,
      updatedAt: sql`now()`
    }).where(inArray(visitorReplyDeliveries.id, rows.map(row => row.id))).returning()
  })
}

async function deliveryDetail(delivery: typeof visitorReplyDeliveries.$inferSelect) {
  const [detail] = await useDb().select({
    workspaceName: workspaces.name,
    workspaceEnabled: workspaces.visitorReplyEmailEnabled,
    visitorEmail: visitors.email,
    visitorEmailEnabled: visitors.replyEmailEnabled,
    visitorConsentAt: visitors.replyEmailConsentAt,
    conversationSpam: conversations.isSpam,
    agentMessageAt: messages.createdAt
  }).from(visitorReplyDeliveries)
    .innerJoin(workspaces, eq(workspaces.id, visitorReplyDeliveries.workspaceId))
    .innerJoin(visitors, eq(visitors.id, visitorReplyDeliveries.visitorRef))
    .innerJoin(conversations, eq(conversations.id, visitorReplyDeliveries.conversationId))
    .innerJoin(messages, eq(messages.id, visitorReplyDeliveries.agentMessageId))
    .where(eq(visitorReplyDeliveries.id, delivery.id)).limit(1)
  return detail
}

async function cancellationReason(delivery: typeof visitorReplyDeliveries.$inferSelect) {
  const detail = await deliveryDetail(delivery)
  if (!detail) return { reason: 'missing_context', detail: null }
  if (!detail.workspaceEnabled) return { reason: 'workspace_disabled', detail }
  if (!detail.visitorEmail || !detail.visitorEmailEnabled || !detail.visitorConsentAt) return { reason: 'visitor_not_opted_in', detail }
  if (visitorEmailHash(detail.visitorEmail) !== delivery.recipientEmailHash) return { reason: 'email_changed', detail }
  if (detail.conversationSpam) return { reason: 'spam', detail }

  const [blocked, suppressed, read] = await Promise.all([
    useDb().query.visitorBlocks.findFirst({
      where: and(eq(visitorBlocks.visitorRef, delivery.visitorRef), sql`${visitorBlocks.unblockedAt} is null`)
    }),
    useDb().query.visitorEmailSuppressions.findFirst({
      where: and(
        eq(visitorEmailSuppressions.workspaceId, delivery.workspaceId),
        eq(visitorEmailSuppressions.emailHash, delivery.recipientEmailHash)
      )
    }),
    useDb().select({ readMessageAt: messages.createdAt })
      .from(visitorConversationReads)
      .innerJoin(messages, eq(messages.id, visitorConversationReads.lastMessageId))
      .where(eq(visitorConversationReads.conversationId, delivery.conversationId)).limit(1)
  ])
  if (blocked) return { reason: 'visitor_blocked', detail }
  if (suppressed) return { reason: `suppressed_${suppressed.reason}`, detail }
  if (read[0] && read[0].readMessageAt.getTime() >= detail.agentMessageAt.getTime()) return { reason: 'already_read', detail }
  return { reason: null, detail }
}

async function overDeliveryLimit(delivery: typeof visitorReplyDeliveries.$inferSelect, now: Date) {
  const hourAgo = new Date(now.getTime() - 60 * 60_000)
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000)
  const [recipientHour, recipientDay, workspaceHour] = await Promise.all([
    useDb().select({ value: count() }).from(visitorReplyDeliveries).where(and(
      eq(visitorReplyDeliveries.recipientEmailHash, delivery.recipientEmailHash),
      eq(visitorReplyDeliveries.status, 'sent'),
      gte(visitorReplyDeliveries.sentAt, hourAgo)
    )),
    useDb().select({ value: count() }).from(visitorReplyDeliveries).where(and(
      eq(visitorReplyDeliveries.recipientEmailHash, delivery.recipientEmailHash),
      eq(visitorReplyDeliveries.status, 'sent'),
      gte(visitorReplyDeliveries.sentAt, dayAgo)
    )),
    useDb().select({ value: count() }).from(visitorReplyDeliveries).where(and(
      eq(visitorReplyDeliveries.workspaceId, delivery.workspaceId),
      eq(visitorReplyDeliveries.status, 'sent'),
      gte(visitorReplyDeliveries.sentAt, hourAgo)
    ))
  ])
  return Number(recipientHour[0]?.value ?? 0) >= 5
    || Number(recipientDay[0]?.value ?? 0) >= 20
    || Number(workspaceHour[0]?.value ?? 0) >= 500
}

export function visitorReplyEmailHtml(input: {
  workspaceName: string
  openUrl: string
  unsubscribeUrl: string
}) {
  return emailLayout({
    title: `${input.workspaceName} replied`,
    body: `<p>Your support conversation has a new reply. For privacy, the message is not shown in this email.</p><p style="color:#64748b">Open the private conversation to read and respond. Replies to this email are not monitored.</p><p style="margin-top:20px;font-size:12px"><a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#64748b">Stop email updates from ${escapeHtml(input.workspaceName)}</a></p>`,
    ctaLabel: 'View reply securely',
    ctaUrl: input.openUrl
  })
}

export type VisitorReplyEmailSender = (message: SendEmailOptions) => Promise<EmailDeliveryResult>

async function deliverOne(
  delivery: typeof visitorReplyDeliveries.$inferSelect,
  now: Date,
  sender: VisitorReplyEmailSender
) {
  const state = await cancellationReason(delivery)
  if (state.reason || !state.detail) {
    await useDb().update(visitorReplyDeliveries).set({
      status: 'canceled', lockedAt: null, cancelReason: state.reason ?? 'invalid', updatedAt: sql`now()`
    }).where(eq(visitorReplyDeliveries.id, delivery.id))
    return
  }
  if (await overDeliveryLimit(delivery, now)) {
    await useDb().update(visitorReplyDeliveries).set({
      status: 'failed', lockedAt: null, attempts: MAX_ATTEMPTS, lastError: 'delivery_rate_limit', updatedAt: sql`now()`
    }).where(eq(visitorReplyDeliveries.id, delivery.id))
    return
  }

  const origin = String(useRuntimeConfig().publicBaseUrl || process.env.PERCH_PUBLIC_URL || '').replace(/\/+$/, '')
  if (!origin) throw new Error('public_origin_missing')
  const openToken = issueReplyLinkToken(delivery.id, delivery.tokenExpiresAt, 'open')
  const unsubscribeToken = issueReplyLinkToken(
    delivery.id,
    new Date(now.getTime() + UNSUBSCRIBE_SECONDS * 1000),
    'unsubscribe'
  )
  const result = await sender({
    to: state.detail.visitorEmail!,
    subject: `${state.detail.workspaceName} replied to your message`,
    html: visitorReplyEmailHtml({
      workspaceName: state.detail.workspaceName,
      openUrl: `${origin}/reply?token=${encodeURIComponent(openToken)}`,
      unsubscribeUrl: `${origin}/reply/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`
    }),
    idempotencyKey: `perch-visitor-reply:${delivery.id}`
  })
  if (!result.accepted) {
    const error = new Error(result.error ?? 'email_provider_rejected') as Error & { retryable?: boolean }
    error.retryable = result.retryable
    throw error
  }
  await useDb().update(visitorReplyDeliveries).set({
    status: 'sent', sentAt: now, lockedAt: null, providerMessageId: result.providerMessageId,
    lastError: null, updatedAt: sql`now()`
  }).where(eq(visitorReplyDeliveries.id, delivery.id))
}

export async function runVisitorReplyEmailSweep(options: { now?: Date, sender?: VisitorReplyEmailSender } = {}) {
  if (!options.sender && useRuntimeConfig().visitorReplyEmailDeliveryEnabled !== true) {
    return { processed: 0 }
  }
  const now = options.now ?? new Date()
  const deliveries = await claimDeliveries(now)
  for (const delivery of deliveries) {
    try {
      await deliverOne(delivery, now, options.sender ?? sendEmailDetailed)
    } catch (cause) {
      const error = cause as Error & { retryable?: boolean }
      const retryable = error.retryable !== false && delivery.attempts < MAX_ATTEMPTS
      await useDb().update(visitorReplyDeliveries).set({
        status: 'failed',
        attempts: retryable ? delivery.attempts : MAX_ATTEMPTS,
        lockedAt: null,
        nextAttemptAt: replyEmailRetryAt(delivery.attempts, now),
        lastError: String(error.message || 'delivery_failed').slice(0, 200),
        updatedAt: sql`now()`
      }).where(eq(visitorReplyDeliveries.id, delivery.id))
    }
  }
  return { processed: deliveries.length }
}
