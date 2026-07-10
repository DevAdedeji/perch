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
  const messages = ref<Array<MessageDTO & { pending?: boolean }>>([])
  const filter = ref<InboxFilter>('all')
  const loadingList = ref(false)
  const loadingThread = ref(false)
  const visitorTyping = ref(false)

  // per-status counts for the tabs — fetched independently of the active filter
  const counts = ref({ unassigned: 0, open: 0, resolved: 0 })

  // composer `/shortcut` templates + the context panel for the open thread
  const canned = ref<CannedResponse[]>([])
  const context = ref<VisitorContext | null>(null)

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
      const data = await $fetch<InboxItem[]>(`/api/workspaces/${workspaceId.value}/conversations${query}`)
      if (seq !== listSeq) return // a newer load superseded this one
      conversations.value = data
    } finally {
      if (seq === listSeq) loadingList.value = false
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
      const data = await $fetch<MessageDTO[]>(`/api/conversations/${id}/messages`)
      if (seq !== threadSeq) return // switched to another chat mid-load
      messages.value = data
      await $fetch(`/api/conversations/${id}/read`, { method: 'POST' }).catch(() => {})
      const item = conversations.value.find(c => c.id === id)
      if (item) item.unread = false
    } finally {
      if (seq === threadSeq) loadingThread.value = false
    }
  }

  function deselect() {
    if (activeId.value) rt.unsubscribe(channels.conversation(activeId.value))
    activeId.value = null
    messages.value = []
    context.value = null
  }

  /* ── actions ─────────────────────────────────────────────── */
  async function sendReply(content: string, isInternalNote = false) {
    const text = content.trim()
    const conversationId = activeId.value
    if (!conversationId || !text) return

    // optimistic: show the message instantly, reconcile with the server + WS echo
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    messages.value.push({
      id: tempId,
      conversation_id: conversationId,
      sender_type: 'agent',
      sender_id: myMemberId.value,
      content: text,
      attachment_url: null,
      attachment_type: null,
      is_internal_note: isInternalNote,
      created_at: new Date().toISOString(),
      pending: true
    })

    try {
      const { message } = await $fetch<{ message: MessageDTO }>(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: { content: text, is_internal_note: isInternalNote }
      })
      // swap the temp for the real one (the WS echo, if it arrives, dedups by id)
      messages.value = messages.value.filter(m => m.id !== tempId)
      if (!messages.value.some(m => m.id === message.id)) messages.value.push(message)
    } catch (e) {
      messages.value = messages.value.filter(m => m.id !== tempId)
      throw e
    }
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
  onMounted(() => {
    rt.connect()
    off = rt.on(applyEvent)
    if (workspaceId.value) loadAll()
  })

  onBeforeUnmount(() => {
    off?.()
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
    status: rt.status,
    memberName,
    memberPresence,
    select,
    deselect,
    assign,
    sendReply,
    claim,
    resolve,
    reopen,
    reload: loadConversations
  }
}
