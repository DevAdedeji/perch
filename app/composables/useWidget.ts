import { channels } from '@perch/shared'
import type { MessageDTO, ServerEvent } from '@perch/shared'

interface WidgetWorkspace {
  name: string
  color: string
  logo_url: string | null
  prechat_enabled: boolean
}

interface SessionResponse {
  workspace: WidgetWorkspace
  agent: { name: string } | null
  visitor: { name: string | null, email: string | null }
  business_online: boolean
  conversation_id: string | null
  messages: MessageDTO[]
  ws_ticket: string
  presence_channel: string
}

/**
 * Visitor-side widget client (runs inside the iframe frame). Persists a
 * per-site `visitor_id`, handshakes, then holds a WS scoped to its own
 * conversation. Messages go over REST; agent replies + typing arrive over WS.
 */
export function useWidget(siteId: string) {
  const workspace = ref<WidgetWorkspace | null>(null)
  const agentName = ref<string | null>(null)
  const businessOnline = ref(false)
  const conversationId = ref<string | null>(null)
  const messages = ref<Array<MessageDTO & { pending?: boolean }>>([])
  const status = ref<'loading' | 'ready' | 'error'>('loading')
  const agentTyping = ref(false)
  const visitorName = ref<string | null>(null)
  const visitorEmail = ref<string | null>(null)

  let visitorId = ''
  let ticket = ''
  let presenceChan = ''
  let socket: WebSocket | null = null
  let alive = true
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined

  function ensureVisitorId() {
    const key = `perch:visitor:${siteId}`
    let id = localStorage.getItem(key)
    if (!id) {
      id = (crypto.randomUUID?.() ?? `v_${Date.now()}_${Math.random().toString(36).slice(2)}`)
      localStorage.setItem(key, id)
    }
    visitorId = id
  }

  async function handshake() {
    const res = await $fetch<SessionResponse>('/api/widget/session', {
      method: 'POST',
      body: { site_id: siteId, visitor_id: visitorId, page_url: document.referrer, ua: navigator.userAgent }
    })
    workspace.value = res.workspace
    agentName.value = res.agent?.name ?? null
    businessOnline.value = res.business_online
    conversationId.value = res.conversation_id
    messages.value = res.messages
    visitorName.value = res.visitor.name
    visitorEmail.value = res.visitor.email
    ticket = res.ws_ticket
    presenceChan = res.presence_channel
  }

  async function refreshAgent() {
    try {
      const res = await $fetch<{ agent: { name: string } | null }>('/api/widget/agent', {
        method: 'POST',
        body: { site_id: siteId, visitor_id: visitorId }
      })
      agentName.value = res.agent?.name ?? null
    } catch {
      // keep the last known agent
    }
  }

  function connectWs() {
    if (!alive || !ticket) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/api/ws?ticket=${encodeURIComponent(ticket)}`)
    socket = ws
    ws.onopen = () => {
      if (presenceChan) send({ type: 'subscribe', channel: presenceChan })
      if (conversationId.value) send({ type: 'subscribe', channel: channels.conversation(conversationId.value) })
    }
    ws.onmessage = (ev) => {
      let msg: { type?: string }
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (!msg.type || msg.type === 'connected' || msg.type === 'subscribed' || msg.type === 'subscribe.error') return
      apply(msg as ServerEvent)
    }
    ws.onclose = () => {
      socket = null
      if (alive) scheduleReconnect()
    }
    ws.onerror = () => ws.close()
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(async () => {
      try {
        await handshake() // fresh ticket
      } catch {
        // ignore; will retry on next close
      }
      connectWs()
    }, 2000)
  }

  function send(obj: unknown) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj))
  }

  function subscribeConversation() {
    if (conversationId.value) send({ type: 'subscribe', channel: channels.conversation(conversationId.value) })
  }

  function apply(ev: ServerEvent) {
    switch (ev.type) {
      case 'message.new':
        // internal notes are filtered server-side; append anything not already present
        if (ev.payload.conversation_id === conversationId.value && !messages.value.some(m => m.id === ev.payload.id)) {
          messages.value.push(ev.payload)
          if (ev.payload.sender_type === 'agent') agentTyping.value = false
        }
        break
      case 'typing':
        if (ev.payload.actor === 'agent' && ev.payload.conversation_id === conversationId.value) {
          agentTyping.value = ev.payload.is_typing
        }
        break
      case 'conversation.updated':
        // an agent claimed/was reassigned — refresh who's handling the chat
        if (ev.payload.id === conversationId.value) refreshAgent()
        break
      case 'business.presence':
        businessOnline.value = ev.payload.online
        break
    }
  }

  async function start() {
    ensureVisitorId()
    try {
      await handshake()
      connectWs()
      status.value = 'ready'
    } catch {
      status.value = 'error'
    }
  }

  async function sendMessage(content: string, identity?: { name?: string, email?: string }) {
    const text = content.trim()
    if (!text) return

    // optimistic: show the message instantly, reconcile with the server response
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    messages.value.push({
      id: tempId,
      conversation_id: conversationId.value ?? 'pending',
      sender_type: 'visitor',
      sender_id: null,
      content: text,
      attachment_url: null,
      attachment_type: null,
      is_internal_note: false,
      created_at: new Date().toISOString(),
      pending: true
    })

    try {
      const res = await $fetch<{ conversation_id: string, message: MessageDTO }>('/api/widget/messages', {
        method: 'POST',
        body: { site_id: siteId, visitor_id: visitorId, content: text, page_url: document.referrer, ...identity }
      })
      if (!conversationId.value) {
        conversationId.value = res.conversation_id
        subscribeConversation()
      }
      if (identity?.name) visitorName.value = identity.name
      if (identity?.email) visitorEmail.value = identity.email
      messages.value = messages.value.filter(m => m.id !== tempId)
      if (!messages.value.some(m => m.id === res.message.id)) messages.value.push(res.message)
    } catch (e) {
      messages.value = messages.value.filter(m => m.id !== tempId)
      throw e
    }
  }

  function sendTyping(isTyping: boolean) {
    if (!conversationId.value) return
    send({ type: isTyping ? 'typing.start' : 'typing.stop', payload: { conversation_id: conversationId.value } })
  }

  function stop() {
    alive = false
    clearTimeout(reconnectTimer)
    socket?.close()
  }

  return {
    workspace,
    agentName,
    businessOnline,
    conversationId,
    messages,
    status,
    agentTyping,
    visitorName,
    visitorEmail,
    start,
    stop,
    sendMessage,
    sendTyping
  }
}
