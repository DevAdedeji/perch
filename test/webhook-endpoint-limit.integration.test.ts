import * as databaseClient from '@@/server/database/client'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import { eq } from '../packages/db/node_modules/drizzle-orm/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import * as schema from '@@/packages/db/src/schema'
import {
  createWebhookEndpoint,
  MAX_WEBHOOK_ENDPOINTS,
  WebhookEndpointLimitError
} from '@@/server/domains/webhooks/endpoints'
import { getTestDatabaseUrl } from '@@/test/helpers/database'

const databaseUrl = getTestDatabaseUrl()

describe.skipIf(!databaseUrl)('webhook endpoint limit database integration', () => {
  const client = postgres(databaseUrl!, { max: MAX_WEBHOOK_ENDPOINTS + 2 })
  const db = drizzle(client, { schema })
  vi.spyOn(databaseClient, 'useDb').mockReturnValue(db)
  const workspaceId = randomUUID()

  beforeAll(async () => {
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Webhook Limit Workspace',
      siteId: `ws_${randomUUID().replaceAll('-', '').slice(0, 10)}`
    })
  })

  afterAll(async () => {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
    await client.end()
  })

  it('never creates more than ten endpoints under concurrent requests', async () => {
    const requests = Array.from({ length: MAX_WEBHOOK_ENDPOINTS + 2 }, (_, index) =>
      createWebhookEndpoint(workspaceId, {
        url: `https://hooks${index}.example.com/perch`,
        secret: `whsec_${randomUUID().replaceAll('-', '')}`,
        events: ['conversation.created']
      })
    )
    const results = await Promise.allSettled(requests)
    const successful = results.filter(result => result.status === 'fulfilled')
    const rejected = results.filter(result => result.status === 'rejected')
    const rows = await db.query.webhookEndpoints.findMany({
      where: eq(schema.webhookEndpoints.workspaceId, workspaceId)
    })

    expect(successful).toHaveLength(MAX_WEBHOOK_ENDPOINTS)
    expect(rejected).toHaveLength(2)
    expect(rejected.every(result => result.status === 'rejected' && result.reason instanceof WebhookEndpointLimitError)).toBe(true)
    expect(rows).toHaveLength(MAX_WEBHOOK_ENDPOINTS)
  })
})
