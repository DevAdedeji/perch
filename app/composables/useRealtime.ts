import type { ServerEvent } from '@perch/shared'

/**
 * Single shared WebSocket to the Control Room (§6). Client-only. Fetches a
 * short-lived ticket, connects, re-subscribes desired channels on reconnect,
 * and fans decoded ServerEvents out to registered handlers.
 */
type Handler = (event: ServerEvent) => void
type Status = 'idle' | 'connecting' | 'open' | 'closed'

// module-level singletons (client only — guarded by import.meta.client)
let socket: WebSocket | null = null
let connecting = false
let backoff = 500
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
const handlers = new Set<Handler>()
const reconnectHandlers = new Set<() => void>()
const desired = new Set<string>()
const CONTROL = new Set(['connected', 'subscribed', 'subscribe.error', 'pong'])

// heartbeat: dead sockets (NAT timeouts, sleeping laptops) otherwise linger
// for minutes while events silently vanish — ping every 25s, kill after 60s idle
const PING_INTERVAL = 25_000
const STALE_AFTER = 60_000
let pingTimer: ReturnType<typeof setInterval> | undefined
let lastActivity = 0
let hadConnected = false

export function useRealtime() {
  const status = useState<Status>('rt:status', () => 'idle')

  function sendRaw(obj: unknown) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj))
  }

  function scheduleReconnect() {
    if (!import.meta.client) return
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => {
      backoff = Math.min(backoff * 2, 10_000)
      connect()
    }, backoff)
  }

  async function connect() {
    if (!import.meta.client || connecting) return
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
    connecting = true
    status.value = 'connecting'
    try {
      const { ticket } = await $fetch<{ ticket: string }>('/api/realtime/ticket')
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/api/ws?ticket=${encodeURIComponent(ticket)}`)
      socket = ws

      ws.onopen = () => {
        backoff = 500
        status.value = 'open'
        for (const channel of desired) sendRaw({ type: 'subscribe', channel })

        // catch up on anything missed while the socket was down
        if (hadConnected) {
          for (const cb of reconnectHandlers) cb()
        }
        hadConnected = true

        lastActivity = Date.now()
        clearInterval(pingTimer)
        pingTimer = setInterval(() => {
          if (Date.now() - lastActivity > STALE_AFTER) {
            ws.close() // stale — onclose reconnects and refetches
            return
          }
          sendRaw({ type: 'ping' })
        }, PING_INTERVAL)
      }
      ws.onmessage = (ev) => {
        lastActivity = Date.now()
        let msg: { type?: string }
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        if (!msg.type || CONTROL.has(msg.type)) return
        for (const h of handlers) h(msg as ServerEvent)
      }
      ws.onclose = () => {
        clearInterval(pingTimer)
        status.value = 'closed'
        socket = null
        scheduleReconnect()
      }
      ws.onerror = () => ws.close()
    } catch {
      status.value = 'closed'
      scheduleReconnect()
    } finally {
      connecting = false
    }
  }

  function subscribe(channel: string) {
    desired.add(channel)
    if (!socket) connect()
    else sendRaw({ type: 'subscribe', channel })
  }

  function unsubscribe(channel: string) {
    desired.delete(channel)
    sendRaw({ type: 'unsubscribe', channel })
  }

  function on(handler: Handler): () => void {
    handlers.add(handler)
    return () => handlers.delete(handler)
  }

  /** Fires after the socket comes BACK (not on first connect) — refetch state here. */
  function onReconnect(handler: () => void): () => void {
    reconnectHandlers.add(handler)
    return () => reconnectHandlers.delete(handler)
  }

  function sendTyping(conversationId: string, isTyping: boolean) {
    sendRaw({ type: isTyping ? 'typing.start' : 'typing.stop', payload: { conversation_id: conversationId } })
  }

  function sendPresence(presence: 'online' | 'away') {
    sendRaw({ type: 'presence.update', payload: { presence } })
  }

  return { status, connect, subscribe, unsubscribe, on, onReconnect, sendTyping, sendPresence }
}
