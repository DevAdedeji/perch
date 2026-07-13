import { channels } from '@perch/shared'
import type { MessageDTO, ServerEvent } from '@perch/shared'

interface WidgetWorkspace {
  name: string
  color: string
  logo_url: string | null
  prechat_enabled: boolean
  has_articles: boolean
}

interface SessionResponse {
  workspace: WidgetWorkspace
  agent: { name: string } | null
  visitor: { name: string | null, email: string | null }
  business_online: boolean
  business_state: 'online' | 'away' | 'offline'
  within_hours: boolean
  away_label: string | null
  conversation_id: string | null
  conversation_status: 'open' | 'unassigned' | 'resolved' | null
  agent_last_read_at: string | null
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
  const businessState = ref<'online' | 'away' | 'offline'>('offline')
  // business-hours schedule state (fixed per session; refreshed on reconnect)
  const withinHours = ref(true)
  const awayLabel = ref<string | null>(null)
  // resolved threads render a "closed" divider; replying reopens server-side
  const conversationStatus = ref<'open' | 'unassigned' | 'resolved' | null>(null)
  const conversationId = ref<string | null>(null)
  const messages = ref<Array<MessageDTO & { pending?: boolean, failed?: boolean }>>([])
  const status = ref<'loading' | 'ready' | 'error'>('loading')
  const agentTyping = ref(false)
  const visitorName = ref<string | null>(null)
  const visitorEmail = ref<string | null>(null)
  // newest agent read — visitor messages at or before this show "Seen"
  const agentReadAt = ref<string | null>(null)

  let visitorId = ''
  // exposed so the composer can sign attachment uploads for this visitor
  const visitorIdRef = ref('')
  let ticket = ''
  let presenceChan = ''
  let socket: WebSocket | null = null
  let alive = true
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  // heartbeat — see useRealtime for the rationale
  let pingTimer: ReturnType<typeof setInterval> | undefined
  let lastActivity = 0

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
    businessState.value = res.business_state ?? (res.business_online ? 'online' : 'offline')
    withinHours.value = res.within_hours ?? true
    awayLabel.value = res.away_label ?? null
    conversationId.value = res.conversation_id
    conversationStatus.value = res.conversation_status ?? null
    messages.value = res.messages
    visitorName.value = res.visitor.name
    visitorEmail.value = res.visitor.email
    agentReadAt.value = res.agent_last_read_at
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

      lastActivity = Date.now()
      clearInterval(pingTimer)
      pingTimer = setInterval(() => {
        if (Date.now() - lastActivity > 60_000) {
          ws.close() // stale — the reconnect path re-handshakes (fresh thread)
          return
        }
        send({ type: 'ping' })
      }, 25_000)
    }
    ws.onmessage = (ev) => {
      lastActivity = Date.now()
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
      clearInterval(pingTimer)
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
          if (conversationStatus.value === 'resolved') conversationStatus.value = 'open'
        }
        break
      case 'typing':
        if (ev.payload.actor === 'agent' && ev.payload.conversation_id === conversationId.value) {
          agentTyping.value = ev.payload.is_typing
        }
        break
      case 'conversation.updated':
        // an agent claimed/was reassigned/resolved — track status + who's handling it
        if (ev.payload.id === conversationId.value) {
          conversationStatus.value = ev.payload.status
          refreshAgent()
        }
        break
      case 'business.presence':
        // outside scheduled hours the business is offline no matter who's here
        businessOnline.value = ev.payload.online && withinHours.value
        businessState.value = withinHours.value ? (ev.payload.state ?? (ev.payload.online ? 'online' : 'offline')) : 'offline'
        break
      case 'conversation.read':
        if (ev.payload.conversation_id === conversationId.value) {
          agentReadAt.value = ev.payload.last_read_at
        }
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
  // finishes creating the conversation before the next one fires). Failed
  // sends stay visible as retryable bubbles.
  let sendChain: Promise<unknown> = Promise.resolve()
  const uploadFns = new Map<string, () => Promise<{ url: string, type: string }>>()

  function queuePost(run: () => Promise<void>) {
    const p = sendChain.then(run, run)
    sendChain = p.catch(() => {})
    return p
  }

  function pushTemp(content: string, attachment?: { url: string, type: string }) {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    messages.value.push({
      id: tempId,
      conversation_id: conversationId.value ?? 'pending',
      sender_type: 'visitor',
      sender_id: null,
      content,
      attachment_url: attachment?.url ?? null,
      attachment_type: attachment?.type ?? null,
      is_internal_note: false,
      created_at: new Date().toISOString(),
      pending: true
    })
    return tempId
  }

  async function performSend(tempId: string, identity?: { name?: string, email?: string }) {
    const temp = messages.value.find(m => m.id === tempId)
    if (!temp) return
    temp.pending = true
    temp.failed = false
    try {
      // upload phase happens outside the queue so a slow image never blocks text
      if (temp.attachment_url?.startsWith('blob:')) {
        const upload = uploadFns.get(tempId)
        if (!upload) throw new Error('upload lost')
        const img = await upload()
        URL.revokeObjectURL(temp.attachment_url)
        temp.attachment_url = img.url
        temp.attachment_type = img.type
      }

      await queuePost(async () => {
        const res = await $fetch<{ conversation_id: string, message: MessageDTO }>('/api/widget/messages', {
          method: 'POST',
          body: {
            site_id: siteId,
            visitor_id: visitorId,
            content: temp.content,
            attachment_url: temp.attachment_url ?? undefined,
            attachment_type: temp.attachment_type ?? undefined,
            page_url: document.referrer,
            ...identity
          }
        })
        if (!conversationId.value) {
          conversationId.value = res.conversation_id
          subscribeConversation()
        }
        // replying to a resolved thread reopens it server-side — reflect that
        if (conversationStatus.value === 'resolved' || conversationStatus.value === null) {
          conversationStatus.value = 'open'
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
        uploadFns.delete(tempId)
      })
    } catch (e) {
      const failedMsg = messages.value.find(m => m.id === tempId)
      if (failedMsg) {
        failedMsg.pending = false
        failedMsg.failed = true
      }
      throw e
    }
  }

  async function sendMessage(
    content: string,
    identity?: { name?: string, email?: string },
    attachment?: { url: string, type: string }
  ) {
    const text = content.trim()
    if (!text && !attachment) return
    await performSend(pushTemp(text, attachment), identity)
  }

  /** Optimistic image send: the bubble shows a local preview while uploading. */
  async function sendAttachment(file: File, upload: () => Promise<{ url: string, type: string }>) {
    const preview = URL.createObjectURL(file)
    const tempId = pushTemp('', { url: preview, type: file.type })
    uploadFns.set(tempId, upload)
    await performSend(tempId).catch(() => {})
  }

  function retrySend(tempId: string) {
    return performSend(tempId).catch(() => {})
  }

  function sendTyping(isTyping: boolean, preview?: string) {
    if (!conversationId.value) return
    send(isTyping
      ? { type: 'typing.start', payload: { conversation_id: conversationId.value, preview: preview?.slice(0, 500) } }
      : { type: 'typing.stop', payload: { conversation_id: conversationId.value } })
  }

  function stop() {
    alive = false
    clearTimeout(reconnectTimer)
    clearInterval(pingTimer)
    socket?.close()
  }

  return {
    workspace,
    visitorId: visitorIdRef,
    agentReadAt,
    agentName,
    businessOnline,
    businessState,
    awayLabel,
    conversationStatus,
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
    sendAttachment,
    retrySend,
    sendTyping
  }
}
