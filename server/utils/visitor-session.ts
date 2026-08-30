import { createHmac, timingSafeEqual } from 'node:crypto'
import { and, eq, visitors, workspaces } from '@perch/db'
import type { H3Event } from 'h3'
import { normalizeInstallationOrigin } from './installation'

const VISITOR_SESSION_TTL_SECONDS = 60 * 60 * 24 * 180

interface VisitorSessionPayload {
  wid: string
  vid: string
  exp: number
}

export interface EmbedTicketPayload {
  sid: string
  hostOrigin: string
  exp: number
  installationPreview?: boolean
}

function visitorSessionSecret(event?: H3Event): string {
  return requireRealtimeSecret(event)
}

function signature(encoded: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(encoded).digest()
}

export function signVisitorSession(
  workspaceId: string,
  visitorRef: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): string {
  const payload: VisitorSessionPayload = {
    wid: workspaceId,
    vid: visitorRef,
    exp: nowSeconds + VISITOR_SESSION_TTL_SECONDS
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${signature(encoded, secret).toString('base64url')}`
}

export function verifyVisitorSession(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const [encoded, supplied, extra] = token.split('.')
  if (!encoded || !supplied || extra) return null

  let suppliedSignature: Buffer
  try {
    suppliedSignature = Buffer.from(supplied, 'base64url')
  } catch {
    return null
  }
  const expected = signature(encoded, secret)
  if (suppliedSignature.length !== expected.length || !timingSafeEqual(suppliedSignature, expected)) return null

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<VisitorSessionPayload>
    if (typeof payload.wid !== 'string' || typeof payload.vid !== 'string'
      || typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null
    return payload as VisitorSessionPayload
  } catch {
    return null
  }
}

export function signEmbedTicket(
  siteId: string,
  secret: string,
  options: { hostOrigin: string, installationPreview?: boolean },
  nowSeconds = Math.floor(Date.now() / 1000)
): string {
  const payload: EmbedTicketPayload = {
    sid: siteId,
    hostOrigin: options.hostOrigin,
    exp: nowSeconds + 5 * 60,
    ...(options.installationPreview ? { installationPreview: true } : {})
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${signature(encoded, secret).toString('base64url')}`
}

export function verifyEmbedTicket(
  token: string,
  siteId: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): EmbedTicketPayload | null {
  const [encoded, supplied, extra] = token.split('.')
  if (!encoded || !supplied || extra) return null
  const expected = signature(encoded, secret)
  const actual = Buffer.from(supplied, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as EmbedTicketPayload
    if (payload.sid !== siteId || typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null
    if (normalizeInstallationOrigin(payload.hostOrigin) !== payload.hostOrigin) return null
    if (payload.installationPreview !== undefined && payload.installationPreview !== true) return null
    return payload
  } catch {
    return null
  }
}

export function issueEmbedTicket(
  event: H3Event,
  siteId: string,
  options: { hostOrigin: string, installationPreview?: boolean }
): string {
  return signEmbedTicket(siteId, visitorSessionSecret(event), options)
}

export function requireEmbedTicket(event: H3Event, siteId: string, token: string): EmbedTicketPayload {
  const payload = verifyEmbedTicket(token, siteId, visitorSessionSecret(event))
  if (!payload) {
    throw createError({ statusCode: 401, statusMessage: 'Embed session is invalid or expired' })
  }
  return payload
}

/** Resolve a signed widget session to its exact workspace and visitor rows. */
export async function requireVisitorSession(event: H3Event, siteId: string, token: string) {
  const payload = verifyVisitorSession(token, visitorSessionSecret(event))
  if (!payload) throw createError({ statusCode: 401, statusMessage: 'Widget session is invalid or expired' })

  const db = useDb()
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.siteId, siteId) })
  if (!workspace || workspace.id !== payload.wid) {
    throw createError({ statusCode: 401, statusMessage: 'Widget session does not belong to this site' })
  }
  const visitor = await db.query.visitors.findFirst({
    where: and(eq(visitors.id, payload.vid), eq(visitors.workspaceId, workspace.id))
  })
  if (!visitor) throw createError({ statusCode: 401, statusMessage: 'Widget session is no longer valid' })

  return { workspace, visitor, payload }
}

export function issueVisitorSession(event: H3Event, workspaceId: string, visitorRef: string) {
  return signVisitorSession(workspaceId, visitorRef, visitorSessionSecret(event))
}
