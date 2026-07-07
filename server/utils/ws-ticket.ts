import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Short-lived, HMAC-signed WebSocket auth ticket. Two subjects:
 *  - agent   → identified by user id; may subscribe to their workspaces.
 *  - visitor → scoped to one workspace + visitor; may only ever subscribe to
 *    that visitor's own conversations (§6.1).
 * The ticket is fetched from a REST endpoint and passed as `?ticket=` on the WS URL.
 */
export type TicketSubject
  = | { role: 'agent', uid: string }
    | { role: 'visitor', wid: string, vid: string }

type TicketPayload = TicketSubject & { exp: number }

const AGENT_TTL_MS = 60_000
const VISITOR_TTL_MS = 10 * 60_000

export function signTicket(subject: TicketSubject, secret: string, ttlMs?: number): string {
  const ttl = ttlMs ?? (subject.role === 'visitor' ? VISITOR_TTL_MS : AGENT_TTL_MS)
  const payload: TicketPayload = { ...subject, exp: Date.now() + ttl }
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

export function verifyTicket(token: string, secret: string): TicketSubject | null {
  const [data, sig] = token.split('.')
  if (!data || !sig) return null

  const expected = createHmac('sha256', secret).update(data).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as TicketPayload
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    if (payload.role === 'agent' && payload.uid) return { role: 'agent', uid: payload.uid }
    if (payload.role === 'visitor' && payload.wid && payload.vid) {
      return { role: 'visitor', wid: payload.wid, vid: payload.vid }
    }
    return null
  } catch {
    return null
  }
}
