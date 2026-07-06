import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Short-lived, HMAC-signed WebSocket auth ticket. The dashboard fetches one from
 * an authenticated REST endpoint, then passes it as `?ticket=` on the WS URL —
 * so the socket is authorized without unsealing the session cookie mid-upgrade.
 */
interface TicketPayload {
  uid: string
  exp: number
}

const DEFAULT_TTL_MS = 60_000

export function signTicket(uid: string, secret: string, ttlMs = DEFAULT_TTL_MS): string {
  const payload: TicketPayload = { uid, exp: Date.now() + ttlMs }
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

export function verifyTicket(token: string, secret: string): { uid: string } | null {
  const [data, sig] = token.split('.')
  if (!data || !sig) return null

  const expected = createHmac('sha256', secret).update(data).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as TicketPayload
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    return { uid: payload.uid }
  } catch {
    return null
  }
}
