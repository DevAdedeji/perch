import { createHmac, randomUUID } from 'node:crypto'
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  lt,
  or,
  sql,
  webhookDeliveries,
  webhookEndpoints,
  webhookEvents,
  webhookJobs
} from '@perch/db'
import type { Database, WebhookEndpoint, WebhookJob } from '@perch/db'
import { postWebhook, safeWebhookError } from './webhook-security'

export const WEBHOOK_EVENTS = ['conversation.created', 'message.created', 'conversation.resolved'] as const
export type WebhookEventName = typeof WEBHOOK_EVENTS[number]

export const MAX_WEBHOOK_ATTEMPTS = 6
const CLAIM_LIMIT = 25
const CLAIM_STALE_MS = 10 * 60_000
const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60_000
const KEEP_STANDALONE_ATTEMPTS = 50
const RETRY_DELAYS_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000]

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export function webhookDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PERCH_WEBHOOK_DELIVERY_ENABLED === 'true'
}

export type WebhookTransport = (
  url: string,
  body: string,
  headers: Record<string, string>
) => Promise<number>

export interface DeliveryResult {
  ok: boolean
  http_status: number | null
  duration_ms: number
  error: string | null
}

export function signWebhook(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function webhookRetryAt(attempt: number, now = new Date()): Date {
  const delay = RETRY_DELAYS_MS[Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, attempt - 1))]!
  return new Date(now.getTime() + delay)
}

export function isRetryableWebhookStatus(status: number | null): boolean {
  return status === null || status === 408 || status === 425 || status === 429 || status >= 500
}

export function webhookEnvelope(
  event: string,
  data: Record<string, unknown>,
  identity: { id?: string, createdAt?: Date } = {}
): string {
  return JSON.stringify({
    id: identity.id ?? randomUUID(),
    event,
    created_at: (identity.createdAt ?? new Date()).toISOString(),
    data
  })
}

export async function enqueueWebhookEvent(
  tx: DbTransaction,
  workspaceId: string,
  event: WebhookEventName,
  data: Record<string, unknown>,
  dedupeKey: string,
  options: { enabled?: boolean } = {}
) {
  if (!(options.enabled ?? webhookDeliveryEnabled())) return null
  const endpoints = await tx.select({ id: webhookEndpoints.id }).from(webhookEndpoints).where(and(
    eq(webhookEndpoints.workspaceId, workspaceId),
    eq(webhookEndpoints.enabled, true),
    sql`${event} = any(${webhookEndpoints.events})`
  ))
  if (!endpoints.length) return null

  const [record] = await tx.insert(webhookEvents).values({
    workspaceId,
    event,
    dedupeKey: dedupeKey.slice(0, 300),
    data
  }).onConflictDoNothing({
    target: [webhookEvents.workspaceId, webhookEvents.dedupeKey]
  }).returning()
  if (!record) return null

  await tx.insert(webhookJobs).values(endpoints.map(endpoint => ({
    workspaceId,
    endpointId: endpoint.id,
    eventId: record.id
  }))).onConflictDoNothing()
  return record.id
}

async function recordAttempt(input: {
  db: Database
  endpointId: string
  jobId?: string
  event: string
  attempt: number
  result: DeliveryResult
}) {
  try {
    await input.db.insert(webhookDeliveries).values({
      endpointId: input.endpointId,
      jobId: input.jobId,
      event: input.event,
      ok: input.result.ok,
      httpStatus: input.result.http_status,
      durationMs: input.result.duration_ms,
      attempt: input.attempt,
      error: input.result.error
    })
    if (!input.jobId) {
      await input.db.execute(sql`
        delete from webhook_deliveries
        where endpoint_id = ${input.endpointId}
          and job_id is null
          and id not in (
            select id from webhook_deliveries
            where endpoint_id = ${input.endpointId} and job_id is null
            order by created_at desc
            limit ${KEEP_STANDALONE_ATTEMPTS}
          )
      `)
    }
  } catch {
    console.error('[webhooks] could not record delivery attempt', {
      endpointId: input.endpointId,
      jobId: input.jobId ?? null,
      attempt: input.attempt
    })
  }
}

export async function deliverOnce(
  endpoint: WebhookEndpoint,
  event: string,
  body: string,
  attempt: number,
  options: {
    db?: Database
    jobId?: string
    idempotencyKey?: string
    transport?: WebhookTransport
    now?: Date
  } = {}
): Promise<DeliveryResult> {
  const db = options.db ?? useDb()
  const timestamp = Math.floor((options.now ?? new Date()).getTime() / 1000)
  const signature = signWebhook(endpoint.secret, timestamp, body)
  const started = Date.now()
  let result: DeliveryResult

  try {
    const httpStatus = await (options.transport ?? postWebhook)(endpoint.url, body, {
      'content-type': 'application/json',
      'x-perch-event': event,
      'x-perch-idempotency-key': options.idempotencyKey ?? JSON.parse(body).id,
      'x-perch-signature': `t=${timestamp},v1=${signature}`
    })
    if (httpStatus < 200 || httpStatus >= 300) {
      throw Object.assign(new Error(`Webhook returned HTTP ${httpStatus}`), { status: httpStatus })
    }
    result = { ok: true, http_status: httpStatus, duration_ms: Date.now() - started, error: null }
  } catch (error) {
    const failure = error as { status?: number }
    result = {
      ok: false,
      http_status: failure.status ?? null,
      duration_ms: Date.now() - started,
      error: safeWebhookError(error)
    }
  }
  await recordAttempt({ db, endpointId: endpoint.id, jobId: options.jobId, event, attempt, result })
  return result
}

async function claimWebhookJobs(db: Database, now: Date) {
  return db.transaction(async (tx) => {
    const stale = new Date(now.getTime() - CLAIM_STALE_MS)
    const rows = await tx.select().from(webhookJobs).where(or(
      and(
        inArray(webhookJobs.status, ['pending', 'retrying']),
        lt(webhookJobs.attempts, MAX_WEBHOOK_ATTEMPTS),
        lt(webhookJobs.nextAttemptAt, new Date(now.getTime() + 1))
      ),
      and(
        eq(webhookJobs.status, 'processing'),
        sql`${webhookJobs.attempts} <= ${MAX_WEBHOOK_ATTEMPTS}`,
        lt(webhookJobs.lockedAt, stale)
      )
    )).orderBy(asc(webhookJobs.nextAttemptAt), asc(webhookJobs.createdAt))
      .limit(CLAIM_LIMIT)
      .for('update', { skipLocked: true })
    if (!rows.length) return []

    return tx.update(webhookJobs).set({
      status: 'processing',
      lockedAt: now,
      lastAttemptAt: now,
      attempts: sql`case when ${webhookJobs.status} = 'processing' then ${webhookJobs.attempts} else ${webhookJobs.attempts} + 1 end`,
      updatedAt: sql`now()`
    }).where(inArray(webhookJobs.id, rows.map(row => row.id))).returning()
  })
}

async function jobContext(db: Database, job: WebhookJob) {
  const [context] = await db.select({
    endpoint: webhookEndpoints,
    event: webhookEvents
  }).from(webhookJobs)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookJobs.endpointId))
    .innerJoin(webhookEvents, eq(webhookEvents.id, webhookJobs.eventId))
    .where(and(
      eq(webhookJobs.id, job.id),
      eq(webhookJobs.workspaceId, job.workspaceId),
      eq(webhookEndpoints.workspaceId, job.workspaceId),
      eq(webhookEvents.workspaceId, job.workspaceId)
    )).limit(1)
  return context ?? null
}

async function cancelProcessingJob(db: Database, jobId: string, reason: string) {
  await db.update(webhookJobs).set({
    status: 'canceled',
    nextAttemptAt: null,
    lockedAt: null,
    cancelReason: reason,
    updatedAt: sql`now()`
  }).where(and(eq(webhookJobs.id, jobId), eq(webhookJobs.status, 'processing')))
}

async function redactCompletedEvent(db: Database, eventId: string) {
  const [remaining] = await db.select({ count: sql<number>`count(*)::int` }).from(webhookJobs).where(and(
    eq(webhookJobs.eventId, eventId),
    inArray(webhookJobs.status, ['pending', 'processing', 'retrying', 'dead_letter'])
  ))
  if (Number(remaining?.count ?? 0) === 0) {
    await db.update(webhookEvents).set({ data: null }).where(eq(webhookEvents.id, eventId))
  }
}

async function processWebhookJob(
  db: Database,
  job: WebhookJob,
  now: Date,
  transport?: WebhookTransport
) {
  const context = await jobContext(db, job)
  if (!context) {
    await cancelProcessingJob(db, job.id, 'missing_context')
    return
  }
  if (!context.endpoint.enabled) {
    await cancelProcessingJob(db, job.id, 'endpoint_disabled')
    await redactCompletedEvent(db, job.eventId)
    return
  }
  if (!context.endpoint.events.includes(context.event.event)) {
    await cancelProcessingJob(db, job.id, 'event_unsubscribed')
    await redactCompletedEvent(db, job.eventId)
    return
  }
  if (!context.event.data) {
    await cancelProcessingJob(db, job.id, 'payload_unavailable')
    return
  }

  const body = webhookEnvelope(context.event.event, context.event.data, {
    id: context.event.id,
    createdAt: context.event.createdAt
  })
  const result = await deliverOnce(context.endpoint, context.event.event, body, job.attempts, {
    db,
    jobId: job.id,
    idempotencyKey: context.event.id,
    transport,
    now
  })
  if (result.ok) {
    const updated = await db.update(webhookJobs).set({
      status: 'succeeded',
      nextAttemptAt: null,
      lockedAt: null,
      deliveredAt: now,
      lastHttpStatus: result.http_status,
      lastDurationMs: result.duration_ms,
      lastError: null,
      cancelReason: null,
      updatedAt: sql`now()`
    }).where(and(eq(webhookJobs.id, job.id), eq(webhookJobs.status, 'processing'))).returning({ id: webhookJobs.id })
    if (updated.length) await redactCompletedEvent(db, job.eventId)
    return
  }

  const retryable = isRetryableWebhookStatus(result.http_status) && job.attempts < MAX_WEBHOOK_ATTEMPTS
  await db.update(webhookJobs).set({
    status: retryable ? 'retrying' : 'dead_letter',
    nextAttemptAt: retryable ? webhookRetryAt(job.attempts, now) : null,
    lockedAt: null,
    lastHttpStatus: result.http_status,
    lastDurationMs: result.duration_ms,
    lastError: result.error,
    updatedAt: sql`now()`
  }).where(and(eq(webhookJobs.id, job.id), eq(webhookJobs.status, 'processing')))
}

async function pruneWebhookHistory(db: Database, now: Date) {
  const cutoff = new Date(now.getTime() - HISTORY_RETENTION_MS)
  await db.delete(webhookEvents).where(and(
    lt(webhookEvents.createdAt, cutoff),
    sql`not exists (
      select 1 from webhook_jobs
      where webhook_jobs.event_id = ${webhookEvents.id}
        and webhook_jobs.status in ('pending', 'processing', 'retrying')
    )`
  ))
}

export async function runWebhookDeliverySweep(options: {
  db?: Database
  now?: Date
  transport?: WebhookTransport
} = {}) {
  const db = options.db ?? useDb()
  const now = options.now ?? new Date()
  const jobs = await claimWebhookJobs(db, now)
  for (let index = 0; index < jobs.length; index += 5) {
    await Promise.all(jobs.slice(index, index + 5).map(job => processWebhookJob(db, job, now, options.transport)))
  }
  await db.execute(sql`
    update webhook_events
    set data = null
    where data is not null
      and not exists (
        select 1 from webhook_jobs
        where webhook_jobs.event_id = webhook_events.id
          and webhook_jobs.status in ('pending', 'processing', 'retrying', 'dead_letter')
      )
  `)
  await pruneWebhookHistory(db, now)
  return { processed: jobs.length }
}

export async function cancelWebhookJobsForEndpoint(
  tx: DbTransaction,
  endpointId: string,
  enabled: boolean,
  subscribedEvents: string[]
) {
  const active = await tx.select({ id: webhookJobs.id, event: webhookEvents.event }).from(webhookJobs)
    .innerJoin(webhookEvents, eq(webhookEvents.id, webhookJobs.eventId))
    .where(and(
      eq(webhookJobs.endpointId, endpointId),
      inArray(webhookJobs.status, ['pending', 'processing', 'retrying'])
    ))
  const ids = active.filter(row => !enabled || !subscribedEvents.includes(row.event)).map(row => row.id)
  if (!ids.length) return 0
  const canceled = await tx.update(webhookJobs).set({
    status: 'canceled',
    nextAttemptAt: null,
    lockedAt: null,
    cancelReason: enabled ? 'event_unsubscribed' : 'endpoint_disabled',
    updatedAt: sql`now()`
  }).where(inArray(webhookJobs.id, ids)).returning({ id: webhookJobs.id })
  await tx.execute(sql`
    update webhook_events
    set data = null
    where data is not null
      and not exists (
        select 1 from webhook_jobs
        where webhook_jobs.event_id = webhook_events.id
          and webhook_jobs.status in ('pending', 'processing', 'retrying', 'dead_letter')
      )
  `)
  return canceled.length
}

export class WebhookReplayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookReplayError'
  }
}

export async function replayWebhookJob(input: {
  db?: Database
  workspaceId: string
  endpointId: string
  jobId: string
  requestId: string
  now?: Date
}) {
  const db = input.db ?? useDb()
  const now = input.now ?? new Date()
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(webhookJobs).where(and(
      eq(webhookJobs.id, input.jobId),
      eq(webhookJobs.endpointId, input.endpointId),
      eq(webhookJobs.workspaceId, input.workspaceId)
    )).for('update')
    if (!job) throw new WebhookReplayError('Delivery not found')
    if (job.lastReplayKey === input.requestId) return job
    if (job.status !== 'dead_letter') throw new WebhookReplayError('Only failed deliveries can be retried')

    const [context] = await tx.select({ endpoint: webhookEndpoints, event: webhookEvents })
      .from(webhookEndpoints)
      .innerJoin(webhookEvents, eq(webhookEvents.id, job.eventId))
      .where(and(
        eq(webhookEndpoints.id, input.endpointId),
        eq(webhookEndpoints.workspaceId, input.workspaceId),
        eq(webhookEvents.workspaceId, input.workspaceId)
      )).limit(1)
    if (!context?.endpoint.enabled || !context.endpoint.events.includes(context.event.event)) {
      throw new WebhookReplayError('Enable this endpoint and event before retrying')
    }
    if (!context.event.data) throw new WebhookReplayError('This delivery is too old to retry')

    const [updated] = await tx.update(webhookJobs).set({
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      lockedAt: null,
      lastError: null,
      cancelReason: null,
      replayCount: sql`${webhookJobs.replayCount} + 1`,
      lastReplayKey: input.requestId,
      updatedAt: sql`now()`
    }).where(eq(webhookJobs.id, job.id)).returning()
    return updated!
  })
}

export async function recentDeliveries(endpointId: string, limit = 25, db: Database = useDb()) {
  const [jobs, standalone] = await Promise.all([
    db.select({ job: webhookJobs, event: webhookEvents }).from(webhookJobs)
      .innerJoin(webhookEvents, eq(webhookEvents.id, webhookJobs.eventId))
      .where(eq(webhookJobs.endpointId, endpointId))
      .orderBy(desc(webhookJobs.createdAt))
      .limit(limit),
    db.query.webhookDeliveries.findMany({
      where: and(eq(webhookDeliveries.endpointId, endpointId), sql`${webhookDeliveries.jobId} is null`),
      orderBy: [desc(webhookDeliveries.createdAt)],
      limit
    })
  ])
  return [
    ...jobs.map(({ job, event }) => ({
      id: job.id,
      event: event.event,
      status: job.status,
      ok: job.status === 'succeeded',
      http_status: job.lastHttpStatus,
      duration_ms: job.lastDurationMs,
      attempts: job.attempts,
      next_attempt_at: job.nextAttemptAt?.toISOString() ?? null,
      error: job.lastError,
      cancel_reason: job.cancelReason,
      replay_count: job.replayCount,
      can_replay: job.status === 'dead_letter' && event.data !== null,
      created_at: job.createdAt.toISOString(),
      updated_at: job.updatedAt.toISOString()
    })),
    ...standalone.map(delivery => ({
      id: delivery.id,
      event: delivery.event,
      status: delivery.ok ? 'succeeded' as const : 'dead_letter' as const,
      ok: delivery.ok,
      http_status: delivery.httpStatus,
      duration_ms: delivery.durationMs,
      attempts: delivery.attempt,
      next_attempt_at: null,
      error: delivery.error,
      cancel_reason: null,
      replay_count: 0,
      can_replay: false,
      created_at: delivery.createdAt.toISOString(),
      updated_at: delivery.createdAt.toISOString()
    }))
  ].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit)
}
