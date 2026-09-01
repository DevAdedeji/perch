import { channels } from '@perch/shared'
import type { ConversationPriority, ConversationStatus, MessageDTO, ResponseSlaDTO, SavedInboxFilters, ServerEvent } from '@perch/shared'

export interface InboxItem {
  id: string
  status: ConversationStatus
  assignedAgentId: string | null
  collaboratorMemberIds: string[]
  priority: ConversationPriority
  snoozedUntil: string | null
  lastMessageAt: string
  createdAt: string
  preview: string
  tags: { id: string, name: string }[]
  unread: boolean
  responseSla: ResponseSlaDTO
  visitor: { id: string, name: string | null, email: string | null, visitorId: string }
}

export interface WorkspaceTag {
  id: string
  name: string
}

export interface InboxSavedView {
  id: string
  name: string
  filters: SavedInboxFilters
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
    profile_name: string | null
    profile_email: string | null
    reported_name: string | null
    reported_email: string | null
    company: string | null
    job_title: string | null
    internal_note: string | null
    profile_version: number
    tags: WorkspaceTag[]
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
  recent_conversations: Array<{
    id: string
    status: ConversationStatus
    last_message_at: string
  }>
}

export interface CustomerProfileUpdate {
  name?: string | null
  email?: string | null
  company?: string | null
  job_title?: string | null
  internal_note?: string | null
  tag_ids?: string[]
}

export type InboxFilter = 'all' | ConversationStatus

/**
 * Drives the Control Room: loads the inbox + a selected thread over REST, wires
 * the workspace/conversation channels over the socket, and applies live events.
 *
 * State lives in shared `useState` (stale-while-revalidate): navigating
 * Team → Inbox re-renders instantly from the cached state while a background
 * refresh runs — skeletons only ever show when there's nothing cached yet.
 */

// monotonic request tokens — module scope so a stale instance's in-flight
// response can never overwrite state owned by a newer mount
let listSeq = 0
let threadSeq = 0
// pending upload fns survive navigation so failed image sends stay retryable
const uploadFns = new Map<string, () => Promise<{ url: string, type: string }>>()
// @mention targets per optimistic send — module scope so retries keep them
const mentionMeta = new Map<string, string[]>()

export function useControlRoom() {
  const { currentWorkspace } = useAuth()
  const rt = useRealtime()

  const conversations = useState<InboxItem[]>('cr:conversations', () => [])
  const members = useState<TeamMember[]>('cr:members', () => [])
  // shared so the dashboard layout can tell whether this conversation is being viewed
  const activeId = useState<string | null>('inbox:activeId', () => null)
  const messages = useState<Array<MessageDTO & { pending?: boolean, failed?: boolean }>>('cr:messages', () => [])
  const filter = useState<InboxFilter>('cr:filter', () => 'all')
  const assigneeFilter = useState<string>('cr:assigneeFilter', () => 'any')
  const priorityFilters = useState<ConversationPriority[]>('cr:priorityFilters', () => [])
  const tagFilters = useState<string[]>('cr:tagFilters', () => [])
  const snoozedFilter = useState<'exclude' | 'include' | 'only'>('cr:snoozedFilter', () => 'exclude')
  const responseFilter = useState<'all' | 'breached'>('cr:responseFilter', () => 'all')
  const workspaceTags = useState<WorkspaceTag[]>('cr:tags', () => [])
  const savedViews = useState<InboxSavedView[]>('cr:savedViews', () => [])
  const loadingList = ref(false)
  const loadingThread = ref(false)
  const visitorTyping = ref(false)
  // sneak-peek: the visitor's live draft (WS-only — never rendered after send)
  const visitorDraft = ref('')

  // per-status counts for the tabs — fetched independently of the active filter
  const counts = useState('cr:counts', () => ({ unassigned: 0, open: 0, resolved: 0, breached: 0 }))

  // composer `/shortcut` templates + the context panel for the open thread
  const canned = useState<CannedResponse[]>('cr:canned', () => [])
  const context = useState<VisitorContext | null>('cr:context', () => null)

  // cursor pagination state (inbox list + open thread)
  const hasMoreConversations = useState('cr:hasMoreConversations', () => false)
  const loadingMore = ref(false)
  const hasMoreMessages = useState('cr:hasMoreMessages', () => false)
  const loadingOlder = ref(false)

  const workspaceId = computed(() => currentWorkspace.value?.workspaceId ?? null)
  const activeConversation = computed(() => conversations.value.find(c => c.id === activeId.value) ?? null)

  // Agents see the unassigned pool, their own chats, and conversations where
  // a teammate explicitly brought them in through an internal-note mention.
  const myRole = computed(() => currentWorkspace.value?.role ?? 'agent')
  const myMemberId = computed(() => currentWorkspace.value?.memberId ?? null)
  function canSee(assignedAgentId: string | null, collaboratorMemberIds: string[] = []): boolean {
    return myRole.value === 'admin'
      || assignedAgentId == null
      || assignedAgentId === myMemberId.value
      || (!!myMemberId.value && collaboratorMemberIds.includes(myMemberId.value))
  }

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

  function appendFilters(params: URLSearchParams) {
    if (filter.value !== 'all') params.set('status', filter.value)
    if (assigneeFilter.value !== 'any') params.set('assignee', assigneeFilter.value)
    if (priorityFilters.value.length) params.set('priority', priorityFilters.value.join(','))
    if (tagFilters.value.length) params.set('tag', tagFilters.value.join(','))
    if (snoozedFilter.value !== 'exclude') params.set('snoozed', snoozedFilter.value)
    if (responseFilter.value !== 'all') params.set('response', responseFilter.value)
  }

  function matchesFilters(conversation: InboxItem) {
    if (filter.value !== 'all' && conversation.status !== filter.value) return false
    if (priorityFilters.value.length && !priorityFilters.value.includes(conversation.priority)) return false
    if (assigneeFilter.value === 'unassigned' && conversation.assignedAgentId) return false
    if (assigneeFilter.value === 'me' && conversation.assignedAgentId !== myMemberId.value) return false
    if (!['any', 'me', 'unassigned'].includes(assigneeFilter.value) && conversation.assignedAgentId !== assigneeFilter.value) return false
    if (tagFilters.value.some(tagId => !conversation.tags.some(tag => tag.id === tagId))) return false
    const activelySnoozed = Boolean(conversation.snoozedUntil && new Date(conversation.snoozedUntil) > new Date())
    if (snoozedFilter.value === 'exclude' && activelySnoozed) return false
    if (snoozedFilter.value === 'only' && !activelySnoozed) return false
    if (responseFilter.value === 'breached' && currentResponseSlaStatus(conversation.responseSla) !== 'breached') return false
    return true
  }

  /* loaders */
  // `showLoader` is used for user-driven loads (tab switch, workspace change);
  // live-event refreshes pass nothing so the list updates without flashing skeletons.
  async function loadConversations({ showLoader = false } = {}) {
    if (!workspaceId.value) return
    const seq = ++listSeq
    if (showLoader) loadingList.value = true
    try {
      const params = new URLSearchParams()
      appendFilters(params)
      const qs = params.size ? `?${params}` : ''
      const data = await $fetch<{ items: InboxItem[], has_more: boolean }>(
        `/api/workspaces/${workspaceId.value}/conversations${qs}`
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
      const params = new URLSearchParams({ before: last.id })
      appendFilters(params)
      const data = await $fetch<{ items: InboxItem[], has_more: boolean }>(
        `/api/workspaces/${workspaceId.value}/conversations?${params}`
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
    counts.value = await $fetch<{ unassigned: number, open: number, resolved: number, breached: number }>(
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

  async function loadSavedViews() {
    if (!workspaceId.value) return
    savedViews.value = await $fetch<InboxSavedView[]>(`/api/workspaces/${workspaceId.value}/saved-views`)
  }

  async function select(id: string, opts: { force?: boolean } = {}) {
    if (activeId.value === id && !opts.force) return
    if (activeId.value) rt.unsubscribe(channels.conversation(activeId.value))
    activeId.value = id
    rt.subscribe(channels.conversation(id))
    visitorTyping.value = false
    visitorDraft.value = ''
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

  /* actions */
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
      mentioned_member_ids: [],
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
          is_internal_note: temp.is_internal_note,
          mentioned_member_ids: mentionMeta.get(tempId)
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
      mentionMeta.delete(tempId)
    } catch {
      const failedMsg = messages.value.find(m => m.id === tempId)
      if (failedMsg) {
        failedMsg.pending = false
        failedMsg.failed = true
      }
    }
  }

  async function sendReply(content: string, isInternalNote = false, attachment?: { url: string, type: string }, mentionedMemberIds?: string[]) {
    const text = content.trim()
    if (!activeId.value || (!text && !attachment)) return
    const tempId = pushTemp(activeId.value, text, isInternalNote, attachment)
    if (mentionedMemberIds?.length) mentionMeta.set(tempId, mentionedMemberIds)
    const temp = messages.value.find(message => message.id === tempId)
    if (temp) temp.mentioned_member_ids = mentionedMemberIds ?? []
    await performSend(tempId)
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
  async function organize(id: string, changes: { priority?: ConversationPriority, snoozed_until?: string | null }) {
    const { conversation } = await $fetch<{ conversation: { priority: ConversationPriority, snoozed_until: string | null } }>(`/api/conversations/${id}/organize`, {
      method: 'PATCH',
      body: changes
    })
    const item = conversations.value.find(conversation => conversation.id === id)
    if (item) {
      item.priority = conversation.priority
      item.snoozedUntil = conversation.snoozed_until
      if (!matchesFilters(item)) {
        conversations.value = conversations.value.filter(conversation => conversation.id !== id)
        if (activeId.value === id) deselect()
      }
    }
  }

  async function updateCustomerProfile(changes: CustomerProfileUpdate) {
    const conversationId = activeId.value
    const current = context.value
    if (!conversationId || !current) return
    try {
      const updated = await $fetch<VisitorContext>(`/api/conversations/${conversationId}/customer`, {
        method: 'PATCH',
        body: { ...changes, expected_version: current.visitor.profile_version }
      })
      if (activeId.value !== conversationId) return
      context.value = updated
      const inboxItem = conversations.value.find(item => item.id === conversationId)
      if (inboxItem) {
        inboxItem.visitor.name = updated.visitor.name
        inboxItem.visitor.email = updated.visitor.email
      }
      return updated
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 409 && activeId.value === conversationId) {
        context.value = await $fetch<VisitorContext>(`/api/conversations/${conversationId}/context`)
      }
      throw error
    }
  }

  /* live events */
  function applyEvent(ev: ServerEvent) {
    switch (ev.type) {
      case 'conversation.new':
        // reload to pick up visitor name + preview + unread in one shot
        loadConversations()
        loadCounts()
        break
      case 'conversation.removed':
        conversations.value = conversations.value.filter(conversation => conversation.id !== ev.payload.conversation_id)
        if (activeId.value === ev.payload.conversation_id) deselect()
        loadCounts()
        break
      case 'conversation.refresh':
        loadConversations()
        if (activeId.value === ev.payload.conversation_id) {
          const seq = threadSeq
          $fetch<VisitorContext>(`/api/conversations/${ev.payload.conversation_id}/context`)
            .then((updated) => {
              if (seq === threadSeq && activeId.value === ev.payload.conversation_id) context.value = updated
            })
            .catch(() => {})
        }
        break
      case 'conversation.updated': {
        const p = ev.payload
        const c = conversations.value.find(x => x.id === p.id)
        if (c) {
          const assignmentChanged = c.assignedAgentId !== p.assigned_agent_id
          const statusChanged = c.status !== p.status
          c.status = p.status
          c.assignedAgentId = p.assigned_agent_id
          c.collaboratorMemberIds = p.collaborator_member_ids
          c.priority = p.priority
          c.snoozedUntil = p.snoozed_until
          c.lastMessageAt = p.last_message_at

          if ((assignmentChanged && !canSee(p.assigned_agent_id, p.collaborator_member_ids)) || !matchesFilters(c)) {
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
        } else if (canSee(p.assigned_agent_id, p.collaborator_member_ids)) {
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
          visitorDraft.value = ''
        }
        if (!m.is_internal_note && (m.sender_type === 'visitor' || m.sender_type === 'agent')) {
          loadConversations()
          loadCounts()
        }
        break
      }
      case 'typing':
        if (ev.payload.conversation_id === activeId.value && ev.payload.actor === 'visitor') {
          visitorTyping.value = ev.payload.is_typing
          visitorDraft.value = ev.payload.is_typing ? (ev.payload.preview ?? '') : ''
        }
        break
      case 'presence': {
        const member = members.value.find(m => m.id === ev.payload.member_id)
        if (member) member.presence = ev.payload.presence
        break
      }
    }
  }

  /* lifecycle */
  let off: (() => void) | undefined

  function loadAll() {
    loadConversations({ showLoader: true })
    loadCounts()
    loadMembers()
    loadCanned()
    loadTags()
    loadSavedViews()
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

  /* tags */
  async function loadTags() {
    if (!workspaceId.value) return
    workspaceTags.value = await $fetch<WorkspaceTag[]>(`/api/workspaces/${workspaceId.value}/tags`)
  }

  async function applyTag(conversationId: string, tag: WorkspaceTag) {
    await $fetch(`/api/conversations/${conversationId}/tags`, { method: 'POST', body: { tag_id: tag.id } })
    const item = conversations.value.find(c => c.id === conversationId)
    if (item && !item.tags.some(t => t.id === tag.id)) {
      item.tags = [...item.tags, tag].sort((a, b) => a.name.localeCompare(b.name))
    }
  }

  async function removeTag(conversationId: string, tagId: string) {
    await $fetch(`/api/conversations/${conversationId}/tags/${tagId}`, { method: 'DELETE' })
    const item = conversations.value.find(c => c.id === conversationId)
    if (item) item.tags = item.tags.filter(t => t.id !== tagId)
  }

  async function createTag(name: string): Promise<WorkspaceTag> {
    const tag = await $fetch<WorkspaceTag>(`/api/workspaces/${workspaceId.value}/tags`, {
      method: 'POST',
      body: { name }
    })
    if (!workspaceTags.value.some(t => t.id === tag.id)) {
      workspaceTags.value = [...workspaceTags.value, tag].sort((a, b) => a.name.localeCompare(b.name))
    }
    return tag
  }

  let offReconnect: (() => void) | undefined
  let snoozeRefresh: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    rt.connect()
    off = rt.on(applyEvent)
    // the socket was down — anything could have happened; refetch it all
    offReconnect = rt.onReconnect(() => {
      loadAll()
      refreshActiveThread()
    })
    if (workspaceId.value) {
      // stale-while-revalidate: skeletons only when nothing is cached
      loadConversations({ showLoader: conversations.value.length === 0 })
      loadCounts()
      loadMembers()
      loadCanned()
      loadTags()
      loadSavedViews()
    }
    // restore the open thread after navigating away and back
    if (activeId.value) {
      if (messages.value.length) {
        rt.subscribe(channels.conversation(activeId.value))
        refreshActiveThread()
        if (!context.value) {
          $fetch<VisitorContext>(`/api/conversations/${activeId.value}/context`)
            .then((ctx) => {
              context.value = ctx
            })
            .catch(() => {})
        }
      } else {
        select(activeId.value, { force: true })
      }
    }
    snoozeRefresh = setInterval(() => {
      if (snoozedFilter.value !== 'include') {
        loadConversations()
        loadCounts()
      }
    }, 60_000)
  })

  onBeforeUnmount(() => {
    off?.()
    offReconnect?.()
    if (snoozeRefresh) clearInterval(snoozeRefresh)
    if (activeId.value) rt.unsubscribe(channels.conversation(activeId.value))
  })

  // follow the workspace switcher
  watch(workspaceId, (next) => {
    activeId.value = null
    messages.value = []
    conversations.value = []
    counts.value = { unassigned: 0, open: 0, resolved: 0, breached: 0 }
    savedViews.value = []
    filter.value = 'all'
    assigneeFilter.value = 'any'
    priorityFilters.value = []
    tagFilters.value = []
    snoozedFilter.value = 'exclude'
    responseFilter.value = 'all'
    if (next) loadAll()
  })

  watch([filter, assigneeFilter, priorityFilters, tagFilters, snoozedFilter, responseFilter], () => loadConversations({ showLoader: true }), { deep: true })

  function currentSavedFilters(): SavedInboxFilters {
    return {
      status: filter.value,
      assignee: assigneeFilter.value,
      priorities: [...priorityFilters.value],
      tag_ids: [...tagFilters.value],
      snoozed: snoozedFilter.value
    }
  }

  function applySavedView(view: InboxSavedView) {
    filter.value = view.filters.status
    assigneeFilter.value = view.filters.assignee
    priorityFilters.value = [...view.filters.priorities]
    tagFilters.value = [...view.filters.tag_ids]
    snoozedFilter.value = view.filters.snoozed
    responseFilter.value = 'all'
  }

  async function saveCurrentView(name: string) {
    if (!workspaceId.value) return
    const view = await $fetch<InboxSavedView>(`/api/workspaces/${workspaceId.value}/saved-views`, {
      method: 'POST',
      body: { name, filters: currentSavedFilters() }
    })
    savedViews.value = [...savedViews.value, view]
    return view
  }

  async function deleteSavedView(id: string) {
    if (!workspaceId.value) return
    await $fetch(`/api/workspaces/${workspaceId.value}/saved-views/${id}`, { method: 'DELETE' })
    savedViews.value = savedViews.value.filter(view => view.id !== id)
  }

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
    visitorDraft,
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
    assigneeFilter,
    priorityFilters,
    tagFilters,
    snoozedFilter,
    responseFilter,
    workspaceTags,
    savedViews,
    currentSavedFilters,
    applySavedView,
    saveCurrentView,
    deleteSavedView,
    applyTag,
    removeTag,
    createTag,
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
    organize,
    updateCustomerProfile,
    reload: loadConversations
  }
}
