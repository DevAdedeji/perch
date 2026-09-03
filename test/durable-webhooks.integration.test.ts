import { createHmac, randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import { eq } from '../packages/db/node_modules/drizzle-orm/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import * as schema from '../packages/db/src/schema'
import {
  cancelWebhookJobsForEndpoint,
  enqueueWebhookEvent,
  replayWebhookJob,
  runWebhookDeliverySweep
} from '../server/utils/webhooks'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('durable webhook database delivery', () => {
  const client = postgres(databaseUrl!, { max: 8 })
  const db = drizzle(client, { schema })
  const workspaceId = randomUUID()

  beforeAll(async () => {
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Durable Webhook Workspace',
      siteId: `ws_${randomUUID().replaceAll('-', '').slice(0, 10)}`
    })
  })

  afterEach(async () => {
    await db.delete(schema.webhookEvents).where(eq(schema.webhookEvents.workspaceId, workspaceId))
    await db.delete(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.workspaceId, workspaceId))
  })

  afterAll(async () => {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
    await client.end()
  })

  async function endpoint(events = ['message.created']) {
    const [row] = await db.insert(schema.webhookEndpoints).values({
      workspaceId,
      url: 'https://hooks.example.com/perch',
      secret: 'whsec_current',
      events
    }).returning()
    return row!
  }

  async function enqueue(dedupeKey = `message.created:${randomUUID()}`) {
    return db.transaction(async tx => enqueueWebhookEvent(tx, workspaceId, 'message.created', {
      message: { id: 'message-1', content: 'Hello' }
    }, dedupeKey, { enabled: true }))
  }

  it('atomically fans one event out once and concurrent sweepers claim it once', async () => {
    await endpoint()
    const dedupeKey = `message.created:${randomUUID()}`
    await enqueue(dedupeKey)
    await enqueue(dedupeKey)
    const sent: string[] = []
    const transport = async (_url: string, body: string) => {
      sent.push(JSON.parse(body).id)
      await new Promise(resolve => setTimeout(resolve, 10))
      return 204
    }

    await Promise.all([
      runWebhookDeliverySweep({ db, now: new Date(Date.now() + 1000), transport }),
      runWebhookDeliverySweep({ db, now: new Date(Date.now() + 1000), transport })
    ])

    expect(sent).toHaveLength(1)
    const jobs = await db.query.webhookJobs.findMany({ where: eq(schema.webhookJobs.workspaceId, workspaceId) })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.status).toBe('succeeded')
    expect(jobs[0]?.attempts).toBe(1)
  })

  it('keeps the event idempotency key stable, uses the latest secret, and retries temporary failures', async () => {
    const target = await endpoint()
    await enqueue()
    await db.update(schema.webhookEndpoints).set({ secret: 'whsec_rotated' }).where(eq(schema.webhookEndpoints.id, target.id))
    const calls: Array<{ body: string, headers: Record<string, string> }> = []
    const first = new Date(Date.now() + 1000)
    await runWebhookDeliverySweep({
      db,
      now: first,
      transport: async (_url, body, headers) => {
        calls.push({ body, headers })
        throw Object.assign(new Error('temporary'), { status: 503 })
      }
    })
    await runWebhookDeliverySweep({
      db,
      now: new Date(first.getTime() + 10_001),
      transport: async (_url, body, headers) => {
        calls.push({ body, headers })
        return 200
      }
    })

    expect(calls).toHaveLength(2)
    const eventId = JSON.parse(calls[0]!.body).id
    expect(JSON.parse(calls[1]!.body).id).toBe(eventId)
    expect(calls.map(call => call.headers['x-perch-idempotency-key'])).toEqual([eventId, eventId])
    const signature = calls[0]!.headers['x-perch-signature']!
    const timestamp = Number(signature.match(/^t=(\d+),/)?.[1])
    const expected = createHmac('sha256', 'whsec_rotated').update(`${timestamp}.${calls[0]!.body}`).digest('hex')
    expect(signature).toBe(`t=${timestamp},v1=${expected}`)
  })

  it('dead-letters permanent failures and replays only once per request id', async () => {
    const target = await endpoint()
    await enqueue()
    await runWebhookDeliverySweep({
      db,
      now: new Date(Date.now() + 1000),
      transport: async () => { throw Object.assign(new Error('invalid'), { status: 422 }) }
    })
    const [failed] = await db.query.webhookJobs.findMany({ where: eq(schema.webhookJobs.workspaceId, workspaceId) })
    expect(failed?.status).toBe('dead_letter')

    await expect(replayWebhookJob({
      db,
      workspaceId: randomUUID(),
      endpointId: target.id,
      jobId: failed!.id,
      requestId: randomUUID()
    })).rejects.toThrow('Delivery not found')

    const requestId = randomUUID()
    const replayed = await replayWebhookJob({
      db,
      workspaceId,
      endpointId: target.id,
      jobId: failed!.id,
      requestId
    })
    const repeated = await replayWebhookJob({
      db,
      workspaceId,
      endpointId: target.id,
      jobId: failed!.id,
      requestId
    })
    expect(replayed.status).toBe('pending')
    expect(repeated.replayCount).toBe(1)
  })

  it('recovers an abandoned processing claim without consuming another attempt', async () => {
    await endpoint()
    await enqueue()
    const [job] = await db.query.webhookJobs.findMany({ where: eq(schema.webhookJobs.workspaceId, workspaceId) })
    const now = new Date('2026-09-02T12:00:00.000Z')
    await db.update(schema.webhookJobs).set({
      status: 'processing',
      attempts: 1,
      lockedAt: new Date(now.getTime() - 11 * 60_000),
      lastAttemptAt: new Date(now.getTime() - 11 * 60_000)
    }).where(eq(schema.webhookJobs.id, job!.id))

    let calls = 0
    await runWebhookDeliverySweep({
      db,
      now,
      transport: async () => {
        calls++
        return 200
      }
    })
    const recovered = await db.query.webhookJobs.findFirst({ where: eq(schema.webhookJobs.id, job!.id) })
    expect(calls).toBe(1)
    expect(recovered?.status).toBe('succeeded')
    expect(recovered?.attempts).toBe(1)
  })

  it('cancels disabled endpoint work and never invokes the transport', async () => {
    const target = await endpoint()
    await enqueue()
    await db.transaction(async (tx) => {
      await tx.update(schema.webhookEndpoints).set({ enabled: false }).where(eq(schema.webhookEndpoints.id, target.id))
      await cancelWebhookJobsForEndpoint(tx, target.id, false, target.events)
    })
    let calls = 0
    await runWebhookDeliverySweep({
      db,
      transport: async () => {
        calls++
        return 200
      }
    })
    const [job] = await db.query.webhookJobs.findMany({ where: eq(schema.webhookJobs.workspaceId, workspaceId) })
    expect(calls).toBe(0)
    expect(job?.status).toBe('canceled')
    expect(job?.cancelReason).toBe('endpoint_disabled')
  })
})
