import { channels } from '@perch/shared'
import type { ConversationStatus, MessageDTO, ServerEvent } from '@perch/shared'

export interface InboxItem {
  id: string
  status: ConversationStatus
  assignedAgentId: string | null
  lastMessageAt: string
  createdAt: string
  preview: string
  unread: boolean
  visitor: { id: string, name: string | null, email: string | null, visitorId: string }
}

export interface TeamMember {
  id: string
  userId: string
  name: string
  email: string
  role: 'admin' | 'agent'
  presence: 'online' | 'offline' | 'away'
}

export interface CannedResponse {
  id: string
  shortcut: string
  content: string
}

export interface VisitorContext {
  visitor: {
    name: string | null
    email: string | null
    visitor_id: string
    external_id: string | null
    identity_verified: boolean
    first_seen_at: string
    last_seen_at: string
    page_url: string | null
    browser: string | null
    os: string | null
  }
  conversation: {
    created_at: string
    status: ConversationStatus
    resolved_at: string | null
  }
  past_conversations: number
}

export type InboxFilter = 'all' | ConversationStatus

/**
 * Drives the Control Room: loads the inbox + a selected thread over REST, wires
 * the workspace/conversation channels over the socket, and applies live events.
 */
export function useControlRoom() {
  const { currentWorkspace } = useAuth()
  const rt = useRealtime()

  const conversations = ref<InboxItem[]>([])
  const members = ref<TeamMember[]>([])
  // shared so the dashboard layout can tell whether this conversation is being viewed
  const activeId = useState<string | null>('inbox:activeId', () => null)
  const messages = ref<Array<MessageDTO & { pending?: boolean, failed?: boolean }>>([])
  const filter = ref<InboxFilter>('all')
  const loadingList = ref(false)
  const loadingThread = ref(false)
  const visitorTyping = ref(false)

  // per-status counts for the tabs — fetched independently of the active filter
  const counts = ref({ unassigned: 0, open: 0, resolved: 0 })

  // composer `/shortcut` templates + the context panel for the open thread
  const canned = ref<CannedResponse[]>([])
  const context = ref<VisitorContext | null>(null)

  // cursor pagination state (inbox list + open thread)
  const hasMoreConversations = ref(false)
  const loadingMore = ref(false)
  const hasMoreMessages = ref(false)
  const loadingOlder = ref(false)

  const workspaceId = computed(() => currentWorkspace.value?.workspaceId ?? null)
  const activeConversation = computed(() => conversations.value.find(c => c.id === activeId.value) ?? null)

  // agents only see the unassigned pool + their own chats; admins see all
  const myRole = computed(() => currentWorkspace.value?.role ?? 'agent')
  const myMemberId = computed(() => currentWorkspace.value?.memberId ?? null)
  function canSee(assignedAgentId: string | null): boolean {
    return myRole.value === 'admin' || assignedAgentId == null || assignedAgentId === myMemberId.value
  }

  // monotonic request tokens so a slow response never overwrites a newer selection
  let listSeq = 0
  let threadSeq = 0

  function memberName(id: string | null): string | null {
    if (!id) return null
    return members.value.find(m => m.id === id)?.name ?? null
  }

  function memberPresence(id: string | null): 'online' | 'away' | 'offline' {
    if (!id) return 'offline'
    return members.value.find(m => m.id === id)?.presence ?? 'offline'
  }

  function resort() {
    conversations.value.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
  }

  /* ── loaders ─────────────────────────────────────────────── */
  // `showLoader` is used for user-driven loads (tab switch, workspace change);
  // live-event refreshes pass nothing so the list updates without flashing skeletons.
  async function loadConversations({ showLoader = false } = {}) {
    if (!workspaceId.value) return
    const seq = ++listSeq
    if (showLoader) loadingList.value = true
    try {
      const query = filter.value === 'all' ? '' : `?status=${filter.value}`
      const data = await $fetch<{ items: InboxItem[], has_more: boolean }>(
        `/api/workspaces/${workspaceId.value}/conversations${query}`
      )
      if (seq !== listSeq) return // a newer load superseded this one
      conversations.value = data.items
      hasMoreConversations.value = data.has_more
    } finally {
      if (seq === listSeq) loadingList.value = false
    }
  }

  async function loadMoreConversations() {
    const last = conversations.value[conversations.value.length - 1]
    if (!workspaceId.value || !last || loadingMore.value) return
    const seq = listSeq
    loadingMore.value = true
    try {
      const status = filter.value === 'all' ? '' : `&status=${filter.value}`
      const data = await $fetch<{ items: InboxItem[], has_more: boolean }>(
        `/api/workspaces/${workspaceId.value}/conversations?before=${last.id}${status}`
      )
      if (seq !== listSeq) return // list was reloaded while we fetched
      const known = new Set(conversations.value.map(c => c.id))
      conversations.value.push(...data.items.filter(c => !known.has(c.id)))
      hasMoreConversations.value = data.has_more
    } finally {
      loadingMore.value = false
    }
  }

  async function loadCounts() {
    if (!workspaceId.value) return
    counts.value = await $fetch<{ unassigned: number, open: number, resolved: number }>(
      `/api/workspaces/${workspaceId.value}/conversation-counts`
    )
  }

  async function loadMembers() {
    if (!workspaceId.value) return
    members.value = await $fetch<TeamMember[]>(`/api/workspaces/${workspaceId.value}/members`)
  }

  async function loadCanned() {
    if (!workspaceId.value) return
    canned.value = await $fetch<CannedResponse[]>(`/api/workspaces/${workspaceId.value}/canned`)
  }

  async function select(id: string) {
    if (activeId.value === id) return
    if (activeId.value) rt.unsubscribe(channels.conversation(activeId.value))
    activeId.value = id
    rt.subscribe(channels.conversation(id))
    visitorTyping.value = false
    messages.value = [] // clear the previous thread immediately so it can't linger
    context.value = null
    loadingThread.value = true

    const seq = ++threadSeq
    // context loads alongside the thread; it must never block or fail the select
    $fetch<VisitorContext>(`/api/conversations/${id}/context`)
      .then((ctx) => {
        if (seq === threadSeq) context.value = ctx
      })
      .catch(() => {})
    try {
      const data = await $fetch<{ items: MessageDTO[], has_more: boolean }>(`/api/conversations/${id}/messages`)
      if (seq !== threadSeq) return // switched to another chat mid-load
      messages.value = data.items
      hasMoreMessages.value = data.has_more
      await $fetch(`/api/conversations/${id}/read`, { method: 'POST' }).catch(() => {})
      const item = conversations.value.find(c => c.id === id)
      if (item) item.unread = false
    } finally {
      if (seq === threadSeq) loadingThread.value = false
    }
  }

  async function loadOlderMessages() {
    const oldest = messages.value[0]
    const conversationId = activeId.value
    if (!conversationId || !oldest || loadingOlder.value) return
    const seq = threadSeq
    loadingOlder.value = true
    try {
      const data = await $fetch<{ items: MessageDTO[], has_more: boolean }>(
        `/api/conversations/${conversationId}/messages?before=${oldest.id}`
      )
      if (seq !== threadSeq) return // switched threads while fetching
      const known = new Set(messages.value.map(m => m.id))
      messages.value.unshift(...data.items.filter(m => !known.has(m.id)))
      hasMoreMessages.value = data.has_more
    } finally {
      loadingOlder.value = false
    }
  }

  function deselect() {
    if (activeId.value) rt.unsubscribe(channels.conversation(activeId.value))
    activeId.value = null
    messages.value = []
    context.value = null
  }

  /* ── actions ─────────────────────────────────────────────── */
  // failed sends stay visible as retryable bubbles; pending uploads keep their
  // upload fn around so retry can re-upload after a network failure
  const uploadFns = new Map<string, () => Promise<{ url: string, type: string }>>()

  function pushTemp(conversationId: string, content: string, isInternalNote: boolean, attachment?: { url: string, type: string }) {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    messages.value.push({
      id: tempId,
      conversation_id: conversationId,
      sender_type: 'agent',
      sender_id: myMemberId.value,
      content,
      attachment_url: attachment?.url ?? null,
      attachment_type: attachment?.type ?? null,
      is_internal_note: isInternalNote,
      created_at: new Date().toISOString(),
      pending: true
    })
    return tempId
  }

  async function performSend(tempId: string) {
    const temp = messages.value.find(m => m.id === tempId)
    if (!temp) return
    temp.pending = true
    temp.failed = false
    try {
      // upload phase (only when the bubble still shows a local blob preview)
      if (temp.attachment_url?.startsWith('blob:')) {
        const upload = uploadFns.get(tempId)
        if (!upload) throw new Error('upload lost')
        const img = await upload()
        URL.revokeObjectURL(temp.attachment_url)
        temp.attachment_url = img.url
        temp.attachment_type = img.type
      }

      const { message } = await $fetch<{ message: MessageDTO }>(`/api/conversations/${temp.conversation_id}/messages`, {
        method: 'POST',
        body: {
          content: temp.content,
          attachment_url: temp.attachment_url ?? undefined,
          attachment_type: temp.attachment_type ?? undefined,
          is_internal_note: temp.is_internal_note
        }
      })
      // reconcile in place (the WS echo, if it arrives first, dedups by id)
      const idx = messages.value.findIndex(m => m.id === tempId)
      if (messages.value.some(m => m.id === message.id)) {
        if (idx !== -1) messages.value.splice(idx, 1)
      } else if (idx !== -1) {
        messages.value.splice(idx, 1, message)
      } else {
        messages.value.push(message)
      }
      uploadFns.delete(tempId)
    } catch {
      const failedMsg = messages.value.find(m => m.id === tempId)
      if (failedMsg) {
        failedMsg.pending = false
        failedMsg.failed = true
      }
    }
  }

  async function sendReply(content: string, isInternalNote = false, attachment?: { url: string, type: string }) {
    const text = content.trim()
    if (!activeId.value || (!text && !attachment)) return
    await performSend(pushTemp(activeId.value, text, isInternalNote, attachment))
  }

  /** Optimistic image send: the bubble shows a local preview while uploading. */
  async function sendAttachment(file: File, upload: () => Promise<{ url: string, type: string }>, isInternalNote = false) {
    if (!activeId.value) return
    const preview = URL.createObjectURL(file)
    const tempId = pushTemp(activeId.value, '', isInternalNote, { url: preview, type: file.type })
    uploadFns.set(tempId, upload)
    await performSend(tempId)
  }

  function retrySend(tempId: string) {
    return performSend(tempId)
  }

  async function claim(id: string) {
    await $fetch(`/api/conversations/${id}/claim`, { method: 'POST' })
  }
  async function assign(id: string, memberId: string) {
    await $fetch(`/api/conversations/${id}/assign`, { method: 'POST', body: { member_id: memberId } })
  }
  async function resolve(id: string) {
    await $fetch(`/api/conversations/${id}/resolve`, { method: 'POST' })
  }
  async function reopen(id: string) {
    await $fetch(`/api/conversations/${id}/reopen`, { method: 'POST' })
  }

  /* ── live events ─────────────────────────────────────────── */
  function applyEvent(ev: ServerEvent) {
    switch (ev.type) {
      case 'conversation.new':
        // reload to pick up visitor name + preview + unread in one shot
        loadConversations()
        loadCounts()
        break
      case 'conversation.updated': {
        const p = ev.payload
        const c = conversations.value.find(x => x.id === p.id)
        if (c) {
          const assignmentChanged = c.assignedAgentId !== p.assigned_agent_id
          const statusChanged = c.status !== p.status
          c.status = p.status
          c.assignedAgentId = p.assigned_agent_id
          c.lastMessageAt = p.last_message_at

          if (assignmentChanged && !canSee(p.assigned_agent_id)) {
            // reassigned to another agent — drop it from my view
            conversations.value = conversations.value.filter(x => x.id !== p.id)
            if (activeId.value === p.id) deselect()
            loadCounts()
          } else {
            resort()
            if (statusChanged) {
              loadCounts()
              if (filter.value !== 'all') loadConversations()
            }
          }
        } else if (canSee(p.assigned_agent_id)) {
          // newly visible to me (assigned to me / returned to the pool)
          loadConversations()
          loadCounts()
        }
        break
      }
      case 'message.new': {
        const m = ev.payload
        const c = conversations.value.find(x => x.id === m.conversation_id)
        if (c) {
          if (!m.is_internal_note) c.preview = m.content
          c.lastMessageAt = m.created_at
          if (m.conversation_id !== activeId.value && m.sender_type === 'visitor') c.unread = true
          resort()
        }
        if (m.conversation_id === activeId.value && !messages.value.some(x => x.id === m.id)) {
          messages.value.push(m)
          visitorTyping.value = false
        }
        break
      }
      case 'typing':
        if (ev.payload.conversation_id === activeId.value && ev.payload.actor === 'visitor') {
          visitorTyping.value = ev.payload.is_typing
        }
        break
      case 'presence': {
        const member = members.value.find(m => m.id === ev.payload.member_id)
        if (member) member.presence = ev.payload.presence
        break
      }
    }
  }

  /* ── lifecycle ───────────────────────────────────────────── */
  let off: (() => void) | undefined

  function loadAll() {
    loadConversations({ showLoader: true })
    loadCounts()
    loadMembers()
    loadCanned()
  }

  // NB: the workspace channel is owned by the dashboard layout (so notifications
  // + presence persist across in-app navigation). Here we only manage the
  // conversation channel for the open thread + the event handler.
  async function refreshActiveThread() {
    const id = activeId.value
    if (!id) return
    const seq = ++threadSeq
    try {
      const data = await $fetch<{ items: MessageDTO[], has_more: boolean }>(`/api/conversations/${id}/messages`)
      if (seq !== threadSeq || activeId.value !== id) return
      // keep local unsent bubbles (pending/failed) on top of the fresh page
      const unsent = messages.value.filter(m => m.pending || m.failed)
      messages.value = [...data.items, ...unsent]
      hasMoreMessages.value = data.has_more
    } catch {
      // next event or manual select will retry
    }
  }

  let offReconnect: (() => void) | undefined
  onMounted(() => {
    rt.connect()
    off = rt.on(applyEvent)
    // the socket was down — anything could have happened; refetch it all
    offReconnect = rt.onReconnect(() => {
      loadAll()
      refreshActiveThread()
    })
    if (workspaceId.value) loadAll()
  })

  onBeforeUnmount(() => {
    off?.()
    offReconnect?.()
    if (activeId.value) rt.unsubscribe(channels.conversation(activeId.value))
  })

  // follow the workspace switcher
  watch(workspaceId, (next) => {
    activeId.value = null
    messages.value = []
    conversations.value = []
    counts.value = { unassigned: 0, open: 0, resolved: 0 }
    if (next) loadAll()
  })

  watch(filter, () => loadConversations({ showLoader: true }))

  return {
    conversations,
    members,
    activeId,
    activeConversation,
    messages,
    filter,
    loadingList,
    loadingThread,
    visitorTyping,
    counts,
    canned,
    context,
    hasMoreConversations,
    loadingMore,
    hasMoreMessages,
    loadingOlder,
    status: rt.status,
    memberName,
    memberPresence,
    select,
    deselect,
    loadMoreConversations,
    loadOlderMessages,
    sendAttachment,
    retrySend,
    assign,
    sendReply,
    claim,
    resolve,
    reopen,
    reload: loadConversations
  }
}
