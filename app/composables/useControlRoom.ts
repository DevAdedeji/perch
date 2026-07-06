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
  const activeId = ref<string | null>(null)
  const messages = ref<MessageDTO[]>([])
  const filter = ref<InboxFilter>('all')
  const loadingList = ref(false)
  const loadingThread = ref(false)
  const visitorTyping = ref(false)

  const workspaceId = computed(() => currentWorkspace.value?.workspaceId ?? null)
  const activeConversation = computed(() => conversations.value.find(c => c.id === activeId.value) ?? null)
  const unassignedCount = computed(() => conversations.value.filter(c => c.status === 'unassigned').length)

  function memberName(id: string | null): string | null {
    if (!id) return null
    return members.value.find(m => m.id === id)?.name ?? null
  }

  function resort() {
    conversations.value.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
  }

  /* ── loaders ─────────────────────────────────────────────── */
  async function loadConversations() {
    if (!workspaceId.value) return
    loadingList.value = true
    try {
      const query = filter.value === 'all' ? '' : `?status=${filter.value}`
      conversations.value = await $fetch<InboxItem[]>(`/api/workspaces/${workspaceId.value}/conversations${query}`)
    } finally {
      loadingList.value = false
    }
  }

  async function loadMembers() {
    if (!workspaceId.value) return
    members.value = await $fetch<TeamMember[]>(`/api/workspaces/${workspaceId.value}/members`)
  }

  async function select(id: string) {
    if (activeId.value && activeId.value !== id) rt.unsubscribe(channels.conversation(activeId.value))
    activeId.value = id
    visitorTyping.value = false
    loadingThread.value = true
    try {
      messages.value = await $fetch<MessageDTO[]>(`/api/conversations/${id}/messages`)
    } finally {
      loadingThread.value = false
    }
    rt.subscribe(channels.conversation(id))
    await $fetch(`/api/conversations/${id}/read`, { method: 'POST' }).catch(() => {})
    const item = conversations.value.find(c => c.id === id)
    if (item) item.unread = false
  }

  /* ── actions ─────────────────────────────────────────────── */
  async function sendReply(content: string, isInternalNote = false) {
    if (!activeId.value || !content.trim()) return
    await $fetch(`/api/conversations/${activeId.value}/messages`, {
      method: 'POST',
      body: { content: content.trim(), is_internal_note: isInternalNote }
    })
    // the new message arrives back over the conversation channel
  }

  async function claim(id: string) {
    await $fetch(`/api/conversations/${id}/claim`, { method: 'POST' })
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
        break
      case 'conversation.updated': {
        const c = conversations.value.find(x => x.id === ev.payload.id)
        if (c) {
          c.status = ev.payload.status
          c.assignedAgentId = ev.payload.assigned_agent_id
          c.lastMessageAt = ev.payload.last_message_at
          resort()
        }
        // a status change may move it out of the current filter
        if (filter.value !== 'all') loadConversations()
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
    }
  }

  /* ── lifecycle ───────────────────────────────────────────── */
  let off: (() => void) | undefined

  onMounted(() => {
    rt.connect()
    off = rt.on(applyEvent)
    if (workspaceId.value) {
      rt.subscribe(channels.workspace(workspaceId.value))
      loadConversations()
      loadMembers()
    }
  })

  onBeforeUnmount(() => {
    off?.()
    if (activeId.value) rt.unsubscribe(channels.conversation(activeId.value))
    if (workspaceId.value) rt.unsubscribe(channels.workspace(workspaceId.value))
  })

  // follow the workspace switcher
  watch(workspaceId, (next, prev) => {
    if (prev) rt.unsubscribe(channels.workspace(prev))
    activeId.value = null
    messages.value = []
    conversations.value = []
    if (next) {
      rt.subscribe(channels.workspace(next))
      loadConversations()
      loadMembers()
    }
  })

  watch(filter, loadConversations)

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
    unassignedCount,
    status: rt.status,
    memberName,
    select,
    sendReply,
    claim,
    resolve,
    reopen,
    reload: loadConversations
  }
}
