import type { ServerEvent } from '@perch/shared'

type Handler = (event: ServerEvent) => void
export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'closed'

export function createRealtimeClient(options: {
  ticket: () => Promise<{ ticket: string }>
  socket: (ticket: string) => WebSocket
  onStatus: (status: RealtimeStatus) => void
}) {
  let generation = 0
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

  function sendRaw(obj: unknown) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj))
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => {
      backoff = Math.min(backoff * 2, 10_000)
      connect()
    }, backoff)
  }

  async function connect() {
    if (connecting) return
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
    const current = generation
    connecting = true
    options.onStatus('connecting')
    try {
      const { ticket } = await options.ticket()
      if (current !== generation) return
      const ws = options.socket(ticket)
      socket = ws

      ws.onopen = () => {
        if (ws !== socket) return
        backoff = 500
        options.onStatus('open')
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
        if (ws !== socket) return
        lastActivity = Date.now()
        let msg: { type?: string }
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string' || CONTROL.has(msg.type)) return
        for (const h of handlers) h(msg as ServerEvent)
      }
      ws.onclose = () => {
        if (ws !== socket) return
        clearInterval(pingTimer)
        options.onStatus('closed')
        socket = null
        scheduleReconnect()
      }
      ws.onerror = () => ws.close()
    } catch {
      if (current !== generation) return
      options.onStatus('closed')
      scheduleReconnect()
    } finally {
      if (current === generation) connecting = false
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

  function sendPresence(workspaceId: string, presence: 'online' | 'away') {
    sendRaw({ type: 'presence.update', payload: { workspace_id: workspaceId, presence } })
  }

  function disconnect() {
    generation++
    clearTimeout(reconnectTimer)
    clearInterval(pingTimer)
    const previous = socket
    socket = null
    connecting = false
    hadConnected = false
    backoff = 500
    desired.clear()
    handlers.clear()
    reconnectHandlers.clear()
    previous?.close()
    options.onStatus('idle')
  }

  return { connect, disconnect, subscribe, unsubscribe, on, onReconnect, sendTyping, sendPresence }
}
