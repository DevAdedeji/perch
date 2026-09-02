import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { count, eq, sql, webhookEndpoints } from '@perch/db'
import type { WebhookEndpoint } from '@perch/db'

export const MAX_WEBHOOK_ENDPOINTS = 10
const DNS_TIMEOUT_MS = 2_000
const CONNECT_TIMEOUT_MS = 3_000
const REQUEST_TIMEOUT_MS = 5_000
const TOTAL_TIMEOUT_MS = 8_000

export interface WebhookTargetPolicy {
  allowHttp?: boolean
  allowLocalhost?: boolean
}

interface ResolvedAddress {
  address: string
  family: number
}

interface ResolveOptions extends WebhookTargetPolicy {
  dnsTimeoutMs?: number
  resolver?: (hostname: string) => Promise<ResolvedAddress[]>
}

interface RequestOptions extends ResolveOptions {
  connectTimeoutMs?: number
  requestTimeoutMs?: number
  totalTimeoutMs?: number
}

export class WebhookEndpointLimitError extends Error {
  constructor() {
    super(`A workspace can have at most ${MAX_WEBHOOK_ENDPOINTS} webhook endpoints`)
    this.name = 'WebhookEndpointLimitError'
  }
}

export function webhookTargetPolicy(
  environment: Record<string, string | undefined> = process.env
): WebhookTargetPolicy {
  const isLocalRuntime = environment.NODE_ENV === 'development' || environment.NODE_ENV === 'test'
  return {
    allowHttp: isLocalRuntime,
    allowLocalhost: isLocalRuntime && environment.PERCH_WEBHOOK_ALLOW_LOCALHOST === 'true'
  }
}

function ipv6Parts(input: string): number[] | null {
  let address = input.toLowerCase()
  if (address.includes('%')) return null

  const dottedIndex = address.lastIndexOf(':')
  if (address.includes('.') && dottedIndex >= 0) {
    const dotted = address.slice(dottedIndex + 1)
    if (isIP(dotted) !== 4) return null
    const bytes = dotted.split('.').map(Number)
    address = `${address.slice(0, dottedIndex)}:${((bytes[0]! << 8) | bytes[1]!).toString(16)}:${((bytes[2]! << 8) | bytes[3]!).toString(16)}`
  }

  const halves = address.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null

  const parts = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
  if (parts.length !== 8 || parts.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null
  return parts.map(part => Number.parseInt(part, 16))
}

function embeddedIpv4(parts: number[]): string | null {
  const mapped = parts.slice(0, 5).every(part => part === 0) && parts[5] === 0xffff
  const compatible = parts.slice(0, 6).every(part => part === 0)
  if (!mapped && !compatible) return null
  return `${parts[6]! >> 8}.${parts[6]! & 255}.${parts[7]! >> 8}.${parts[7]! & 255}`
}

export function isPublicIp(input: string): boolean {
  const address = input.toLowerCase().replace(/^\[|\]$/g, '')
  const version = isIP(address)
  if (version === 4) {
    const [a, b, c] = address.split('.').map(Number)
    if (a === undefined || b === undefined || c === undefined) return false
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113))
  }
  if (version === 6) {
    const parts = ipv6Parts(address)
    if (!parts) return false
    const embedded = embeddedIpv4(parts)
    if (embedded) return isPublicIp(embedded)
    if (parts[0]! < 0x2000 || parts[0]! > 0x3fff) return false
    if (parts[0] === 0x2002 || parts[0] === 0x3fff) return false
    if (parts[0] === 0x2001 && (
      parts[1] === 0
      || parts[1] === 2
      || parts[1] === 0x0db8
      || (parts[1]! & 0xfff0) === 0x10
      || (parts[1]! & 0xfff0) === 0x20
    )) return false
    return true
  }
  return false
}

function isAllowedLocalhost(host: string): boolean {
  if (host === 'localhost') return true
  if (isIP(host) === 4) return host.split('.')[0] === '127'
  if (isIP(host) === 6) {
    const parts = ipv6Parts(host)
    if (!parts) return false
    const embedded = embeddedIpv4(parts)
    return host === '::1' || Boolean(embedded?.startsWith('127.'))
  }
  return false
}

export function isSafeWebhookUrl(url: string, policy = webhookTargetPolicy()): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && policy.allowHttp)) return false
  if (parsed.username || parsed.password) return false
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return false
  if (isAllowedLocalhost(host)) return Boolean(policy.allowLocalhost)
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return false
  if (isIP(host) && !isPublicIp(host)) return false
  return true
}

export function webhookAuditTarget(input: string): string {
  try {
    const parsed = new URL(input)
    const port = parsed.port ? `:${parsed.port}` : ''
    return `${parsed.protocol}//${parsed.hostname}${port}`
  } catch {
    return 'invalid webhook target'
  }
}

export function safeWebhookError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Delivery failed'
  return message.replace(/https?:\/\/[^\s]+/gi, value => webhookAuditTarget(value)).slice(0, 500)
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function resolvePublicTarget(url: string, options: ResolveOptions = {}) {
  const defaults = webhookTargetPolicy()
  const policy = {
    allowHttp: options.allowHttp ?? defaults.allowHttp,
    allowLocalhost: options.allowLocalhost ?? defaults.allowLocalhost
  }
  if (!isSafeWebhookUrl(url, policy)) throw new Error('Webhook target is not allowed')

  const parsed = new URL(url)
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  const literalVersion = isIP(hostname)
  const resolver = options.resolver ?? (async host => await lookup(host, { all: true, verbatim: true }))
  const addresses = literalVersion
    ? [{ address: hostname, family: literalVersion }]
    : await bounded(resolver(hostname), options.dnsTimeoutMs ?? DNS_TIMEOUT_MS, 'Webhook DNS lookup timed out')

  const localhostAllowed = Boolean(policy.allowLocalhost && isAllowedLocalhost(hostname))
  if (!addresses.length || addresses.some(entry => !(localhostAllowed && isAllowedLocalhost(entry.address)) && !isPublicIp(entry.address))) {
    throw new Error('Webhook target resolves to a non-public address')
  }
  return { parsed, target: addresses[0]! }
}

export async function postWebhook(
  url: string,
  body: string,
  headers: Record<string, string>,
  options: RequestOptions = {}
): Promise<number> {
  const started = Date.now()
  const totalTimeoutMs = options.totalTimeoutMs ?? TOTAL_TIMEOUT_MS
  const { parsed, target } = await resolvePublicTarget(url, {
    ...options,
    dnsTimeoutMs: Math.min(options.dnsTimeoutMs ?? DNS_TIMEOUT_MS, totalTimeoutMs)
  })
  const remainingMs = Math.max(1, totalTimeoutMs - (Date.now() - started))

  return await new Promise<number>((resolve, reject) => {
    let settled = false
    let connectTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error, status?: number) => {
      if (settled) return
      settled = true
      clearTimeout(connectTimer)
      clearTimeout(totalTimer)
      if (error) reject(error)
      else resolve(status ?? 0)
    }
    const request = (parsed.protocol === 'https:' ? httpsRequest : httpRequest)(parsed, {
      method: 'POST',
      headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
      lookup: (_hostname, _lookupOptions, callback) => callback(null, target.address, target.family as 4 | 6)
    }, (response) => {
      response.resume()
      response.once('error', error => finish(error))
      response.once('end', () => {
        const status = response.statusCode ?? 0
        if (status >= 200 && status < 300) finish(undefined, status)
        else finish(Object.assign(new Error(`Webhook returned HTTP ${status}`), { status }))
      })
    })
    request.once('socket', (socket) => {
      if (!socket.connecting) return
      const connectedEvent = parsed.protocol === 'https:' ? 'secureConnect' : 'connect'
      connectTimer = setTimeout(
        () => request.destroy(new Error('Webhook connection timed out')),
        Math.min(options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS, remainingMs)
      )
      socket.once(connectedEvent, () => clearTimeout(connectTimer))
    })
    request.setTimeout(options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('Webhook request timed out'))
    })
    const totalTimer = setTimeout(() => request.destroy(new Error('Webhook delivery timed out')), remainingMs)
    request.once('error', error => finish(error))
    request.end(body)
  })
}

export async function createWebhookEndpoint(
  workspaceId: string,
  input: { url: string, secret: string, events: string[] }
): Promise<WebhookEndpoint> {
  return await useDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`webhook-endpoints:${workspaceId}`}))`)
    const [{ n }] = await tx.select({ n: count() }).from(webhookEndpoints)
      .where(eq(webhookEndpoints.workspaceId, workspaceId)) as [{ n: number }]
    if (n >= MAX_WEBHOOK_ENDPOINTS) throw new WebhookEndpointLimitError()
    const [row] = await tx.insert(webhookEndpoints).values({ workspaceId, ...input }).returning()
    return row!
  })
}
