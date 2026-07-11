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
  // exposed so the composer can sign attachment uploads for this visitor
  const visitorIdRef = ref('')
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
    visitorIdRef.value = id
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
          // WS echo of our own optimistic send — swap the temp bubble in place
          const tempIdx = ev.payload.sender_type === 'visitor'
            ? messages.value.findIndex(m => m.pending && m.content === ev.payload.content)
            : -1
          if (tempIdx !== -1) {
            messages.value.splice(tempIdx, 1, ev.payload)
          } else {
            messages.value.push(ev.payload)
            if (ev.payload.sender_type === 'agent') agentTyping.value = false
          }
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

  /* ── host-site identity (Perch.identify) ─────────────── */
  interface IdentityTraits {
    user_id?: string
    name?: string
    email?: string
    hash?: string
  }

  // traits arriving before the handshake are queued; traits always win over
  // whatever the handshake loaded (the host site is the fresher source)
  let sessionReady = false
  let queuedIdentity: IdentityTraits | null = null

  async function pushIdentity(traits: IdentityTraits) {
    try {
      await $fetch('/api/widget/identify', {
        method: 'POST',
        body: { site_id: siteId, visitor_id: visitorId, ...traits }
      })
    } catch {
      // identity is best-effort from the widget's side; the session still works
    }
  }

  function identify(traits: IdentityTraits) {
    const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
    const clean: IdentityTraits = {
      user_id: str(traits.user_id, 128),
      name: str(traits.name, 100),
      email: str(traits.email, 200),
      hash: str(traits.hash, 64)
    }
    if (!clean.user_id && !clean.name && !clean.email) return
    if (clean.name) visitorName.value = clean.name
    if (clean.email) visitorEmail.value = clean.email
    if (!sessionReady) {
      queuedIdentity = clean
      return
    }
    pushIdentity(clean)
  }

  async function start() {
    ensureVisitorId()
    try {
      await handshake()
      connectWs()
      status.value = 'ready'
      sessionReady = true
      if (queuedIdentity) {
        const traits = queuedIdentity
        queuedIdentity = null
        // re-apply — the handshake may have overwritten the refs with stale values
        if (traits.name) visitorName.value = traits.name
        if (traits.email) visitorEmail.value = traits.email
        pushIdentity(traits)
      }
    } catch {
      status.value = 'error'
    }
  }

  // POSTs are serialized so rapid sends keep their order (and the first send
  // finishes creating the conversation before the next one fires)
  let sendChain: Promise<unknown> = Promise.resolve()

  async function sendMessage(
    content: string,
    identity?: { name?: string, email?: string },
    attachment?: { url: string, type: string }
  ) {
    const text = content.trim()
    if (!text && !attachment) return

    // optimistic: show the message instantly, reconcile with the server response
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    messages.value.push({
      id: tempId,
      conversation_id: conversationId.value ?? 'pending',
      sender_type: 'visitor',
      sender_id: null,
      content: text,
      attachment_url: attachment?.url ?? null,
      attachment_type: attachment?.type ?? null,
      is_internal_note: false,
      created_at: new Date().toISOString(),
      pending: true
    })

    const run = async () => {
      try {
        const res = await $fetch<{ conversation_id: string, message: MessageDTO }>('/api/widget/messages', {
          method: 'POST',
          body: {
            site_id: siteId,
            visitor_id: visitorId,
            content: text,
            attachment_url: attachment?.url,
            attachment_type: attachment?.type,
            page_url: document.referrer,
            ...identity
          }
        })
        if (!conversationId.value) {
          conversationId.value = res.conversation_id
          subscribeConversation()
        }
        if (identity?.name) visitorName.value = identity.name
        if (identity?.email) visitorEmail.value = identity.email
        // reconcile in place — replacing (not filter + push) keeps send order
        const idx = messages.value.findIndex(m => m.id === tempId)
        if (messages.value.some(m => m.id === res.message.id)) {
          if (idx !== -1) messages.value.splice(idx, 1)
        } else if (idx !== -1) {
          messages.value.splice(idx, 1, res.message)
        } else {
          messages.value.push(res.message)
        }
      } catch (e) {
        messages.value = messages.value.filter(m => m.id !== tempId)
        throw e
      }
    }

    const p = sendChain.then(run, run)
    sendChain = p.catch(() => {})
    return p
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
    visitorId: visitorIdRef,
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
    identify,
    sendMessage,
    sendTyping
  }
}
