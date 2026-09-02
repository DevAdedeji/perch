import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { drizzle } from '../packages/db/node_modules/drizzle-orm/postgres-js/index.js'
import { eq } from '../packages/db/node_modules/drizzle-orm/index.js'
import postgres from '../packages/db/node_modules/postgres/src/index.js'
import * as schema from '../packages/db/src/schema'
import {
  decodeSessionClientContext,
  encodeSessionClientContext,
  isEncodedSessionClientContext,
  parseClientContext
} from '../server/utils/client-context'
import { assertSessionAlive } from '../server/utils/db-sessions'
import { runPrivacyRetentionSweep } from '../server/utils/privacy-retention'

const chromeMacUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'
const safariPhoneUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1'

describe('privacy-safe client context', () => {
  it('keeps only coarse browser, OS, and device labels', () => {
    expect(parseClientContext(chromeMacUa)).toEqual({ browser: 'Chrome', os: 'macOS', device: 'desktop' })
    expect(parseClientContext(safariPhoneUa)).toEqual({ browser: 'Safari', os: 'iOS', device: 'mobile' })
    expect(parseClientContext('Mozilla/5.0 (Linux; Android 15; Pixel Tablet) Chrome/140.0 Safari/537.36'))
      .toEqual({ browser: 'Chrome', os: 'Android', device: 'tablet' })

    const stored = encodeSessionClientContext(chromeMacUa)
    expect(isEncodedSessionClientContext(stored)).toBe(true)
    expect(stored).not.toContain('140.0.0.0')
    expect(stored).not.toContain('Mozilla')
    expect(decodeSessionClientContext(stored)).toEqual({ browser: 'Chrome', os: 'macOS', device: 'desktop' })
  })

  it('reads legacy values without sending the raw value to the browser', () => {
    expect(decodeSessionClientContext(safariPhoneUa)).toEqual({ browser: 'Safari', os: 'iOS', device: 'mobile' })
    expect(decodeSessionClientContext('perch-device:v1:broken:Unknown:Secrets')).toEqual({
      browser: 'Browser',
      os: null,
      device: 'unknown'
    })
  })

  it('removes raw user agents at both public response boundaries', () => {
    const widgetRoute = readFileSync(new URL('../server/api/widget/session.post.ts', import.meta.url), 'utf8')
    const widgetClient = readFileSync(new URL('../app/composables/useWidget.ts', import.meta.url), 'utf8')
    const sessionRoute = readFileSync(new URL('../server/api/auth/sessions.get.ts', import.meta.url), 'utf8')
    expect(widgetRoute).toContain('- \'ua\'')
    expect(widgetRoute).toContain('parseClientContext(getHeader(event, \'user-agent\'))')
    expect(widgetClient).not.toContain('navigator.userAgent')
    expect(sessionRoute).not.toContain('user_agent: r.userAgent')
    expect(sessionRoute).toContain('device_type: context.device')
  })
})

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('privacy retention database integration', () => {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema })
  const userId = randomUUID()
  const workspaceId = randomUUID()
  const expiredSessionId = randomUUID()
  const oldIpSessionId = randomUUID()
  const freshSessionId = randomUUID()
  const legacyVisitorId = randomUUID()
  const safeVisitorId = randomUUID()
  const clearUserSession = vi.fn(async () => {})

  beforeAll(async () => {
    Object.assign(globalThis, {
      useDb: () => db,
      clearUserSession,
      createError: (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)
    })
    const now = Date.now()
    await db.insert(schema.users).values({
      id: userId,
      email: `${userId}@example.com`,
      name: 'Privacy test'
    })
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Privacy test',
      siteId: `ws_${randomUUID().replaceAll('-', '').slice(0, 10)}`
    })
    await db.insert(schema.sessions).values([
      {
        id: expiredSessionId,
        userId,
        userAgent: chromeMacUa,
        ip: '203.0.113.10',
        createdAt: new Date(now - 110 * 24 * 60 * 60 * 1000),
        lastSeenAt: new Date(now - 100 * 24 * 60 * 60 * 1000)
      },
      {
        id: oldIpSessionId,
        userId,
        userAgent: chromeMacUa,
        ip: '203.0.113.11',
        createdAt: new Date(now - 31 * 24 * 60 * 60 * 1000),
        lastSeenAt: new Date(now - 2 * 60 * 1000)
      },
      {
        id: freshSessionId,
        userId,
        userAgent: encodeSessionClientContext(safariPhoneUa),
        ip: '203.0.113.12',
        createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
        lastSeenAt: new Date(now - 2 * 60 * 1000)
      }
    ])
    await db.insert(schema.visitors).values([
      {
        id: legacyVisitorId,
        workspaceId,
        visitorId: `visitor_${randomUUID()}`,
        metadata: { ua: safariPhoneUa, page_url: 'https://example.com/pricing' }
      },
      {
        id: safeVisitorId,
        workspaceId,
        visitorId: `visitor_${randomUUID()}`,
        metadata: { browser: 'Firefox', os: 'Linux', device: 'desktop' }
      }
    ])
  })

  afterAll(async () => {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
    await db.delete(schema.users).where(eq(schema.users.id, userId))
    await client.end()
  })

  it('expires idle sessions immediately at authentication time', async () => {
    await expect(assertSessionAlive({} as never, expiredSessionId, userId)).rejects.toMatchObject({ statusCode: 401 })
    expect(clearUserSession).toHaveBeenCalledOnce()
    expect(await db.query.sessions.findFirst({ where: eq(schema.sessions.id, expiredSessionId) })).toBeUndefined()
  })

  it('enforces retention without changing safe or recently captured data', async () => {
    const result = await runPrivacyRetentionSweep(db, new Date())
    expect(result.clearedSessionIps).toBeGreaterThanOrEqual(1)
    expect(result.sanitizedSessionAgents).toBeGreaterThanOrEqual(1)
    expect(result.sanitizedVisitorAgents).toBeGreaterThanOrEqual(1)

    const oldIpSession = await db.query.sessions.findFirst({ where: eq(schema.sessions.id, oldIpSessionId) })
    const freshSession = await db.query.sessions.findFirst({ where: eq(schema.sessions.id, freshSessionId) })
    expect(oldIpSession?.ip).toBeNull()
    expect(oldIpSession?.userAgent).toBe(encodeSessionClientContext(chromeMacUa))
    expect(freshSession?.ip).toBe('203.0.113.12')
    expect(freshSession?.userAgent).toBe(encodeSessionClientContext(safariPhoneUa))

    const legacyVisitor = await db.query.visitors.findFirst({ where: eq(schema.visitors.id, legacyVisitorId) })
    const safeVisitor = await db.query.visitors.findFirst({ where: eq(schema.visitors.id, safeVisitorId) })
    expect(legacyVisitor?.metadata).toEqual({
      page_url: 'https://example.com/pricing',
      browser: 'Safari',
      os: 'iOS',
      device: 'mobile'
    })
    expect(safeVisitor?.metadata).toEqual({ browser: 'Firefox', os: 'Linux', device: 'desktop' })

    await runPrivacyRetentionSweep(db, new Date())
    expect(await db.query.sessions.findFirst({ where: eq(schema.sessions.id, oldIpSessionId) }))
      .toMatchObject({ ip: null, userAgent: encodeSessionClientContext(chromeMacUa) })
    expect((await db.query.visitors.findFirst({ where: eq(schema.visitors.id, legacyVisitorId) }))?.metadata)
      .toEqual(legacyVisitor?.metadata)
  })
})
