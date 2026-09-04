import { channels } from '@perch/shared'
import type { ConversationPriority, ConversationStatus, MessageDTO, ResponseSlaDTO, SavedInboxFilters, ServerEvent } from '@perch/shared'
import { inboxOutboxFor } from '../utils/inbox-outbox'
import type { InboxMessage } from '../utils/inbox-outbox'
import { claimInboxRequests } from '../utils/inbox-requests'

export interface InboxItem {
  id: string
  status: ConversationStatus
  isSpam: boolean
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
  name: string
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
    messaging_blocked: boolean
    reply_email: {
      eligible: boolean
      status: 'pending' | 'processing' | 'sent' | 'failed' | 'canceled' | null
      cancel_reason: string | null
    }
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

export type BulkConversationInput
  = | { action: 'assign', conversation_ids: string[], member_id: string }
    | { action: 'resolve' | 'reopen', conversation_ids: string[] }
    | { action: 'add_tag' | 'remove_tag', conversation_ids: string[], tag_id: string }

export interface BulkConversationResult {
  action: BulkConversationInput['action']
  requested_count: number
  changed_count: number
  unchanged_count: number
}

export type InboxFilter = 'all' | ConversationStatus | 'spam'

/**
 * Drives the Control Room: loads the inbox + a selected thread over REST, wires
 * the workspace/conversation channels over the socket, and applies live events.
 *
 * State lives in shared `useState` (stale-while-revalidate): navigating
 * Team → Inbox re-renders instantly from the cached state while a background
 * refresh runs — skeletons only ever show when there's nothing cached yet.
 */

export function useControlRoom() {
  const { currentWorkspace, user } = useAuth()
  const rt = useRealtime()
  const app = useNuxtApp()
  const outbox = inboxOutboxFor(app)

  const conversations = useState<InboxItem[]>('cr:conversations', () => [])
  const members = useState<TeamMember[]>('cr:members', () => [])
  // shared so the dashboard layout can tell whether this conversation is being viewed
  const activeId = useState<string | null>('inbox:activeId', () => null)
  const messages = useState<InboxMessage[]>('cr:messages', () => [])
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
  const counts = useState('cr:counts', () => ({ unassigned: 0, open: 0, resolved: 0, spam: 0, breached: 0 }))

  // composer `/shortcut` templates + the context panel for the open thread
  const canned = useState<CannedResponse[]>('cr:canned', () => [])
  const context = useState<VisitorContext | null>('cr:context', () => null)

  // cursor pagination state (inbox list + open thread)
  const hasMoreConversations = useState('cr:hasMoreConversations', () => false)
  const loadingMore = ref(false)
  const hasMoreMessages = useState('cr:hasMoreMessages', () => false)
  const loadingOlder = ref(false)

  const workspaceId = computed(() => currentWorkspace.value?.workspaceId ?? null)
  const identity = computed(() => {
    const workspace = currentWorkspace.value
    return user.value && workspace
      ? `${user.value.id}:${workspace.workspaceId}:${workspace.memberId}:${workspace.role}`
      : null
  })
  const cachedIdentity = useState<string | null>('cr:identity', () => null)
  const requests = claimInboxRequests(app, () => identity.value)
  let listSeq = 0
  let threadSeq = 0
  let disposed = false
  const activeConversation = computed(() => conversations.value.find(c => c.id === activeId.value) ?? null)

  // Agents see the unassigned pool, their own chats, and conversations where
  // a teammate explicitly brought them in through an internal-note mention.
  const myRole = computed(() => currentWorkspace.value?.role ?? 'agent')
  const myMemberId = computed(() => currentWorkspace.value?.memberId ?? null)

  function syncPending(conversationId: string, sent?: { temporaryId: string, message: MessageDTO }) {
    if (disposed || !requests.active || cachedIdentity.value !== identity.value || activeId.value !== conversationId) return
    const delivered = messages.value.filter(message => !message.pending && !message.failed && message.id !== sent?.temporaryId)
    if (sent && !delivered.some(message => message.id === sent.message.id)) delivered.push(sent.message)
    messages.value = [...delivered, ...outbox.pending(conversationId)]
  }
  const offOutbox = outbox.subscribe(syncPending)

  function applyThreadPage(items: MessageDTO[], id: string, existingIds: Set<string>) {
    // A REST snapshot may predate a reply acknowledged while it was loading.
    const arrivedDuringLoad = messages.value.filter(message => !message.pending && !message.failed && !existingIds.has(message.id))
    for (const message of items) outbox.acknowledge(message)
    const known = new Set(items.map(message => message.id))
    messages.value = [...items, ...arrivedDuringLoad.filter(message => !known.has(message.id)), ...outbox.pending(id)]
  }

  function threadCurrent(id: string): () => boolean {
    const current = requests.capture()
    const seq = threadSeq
    return () => current() && seq === threadSeq && activeId.value === id
  }

  function dropInaccessibleThread(error: unknown, id: string): boolean {
    const status = (error as { statusCode?: number, status?: number } | null)?.statusCode
      ?? (error as { status?: number } | null)?.status
    if (![401, 403, 404].includes(status ?? 0)) return false
    outbox.discardConversation(id)
    conversations.value = conversations.value.filter(conversation => conversation.id !== id)
    if (activeId.value === id) deselect()
    return true
  }

  async function loadContext(id: string) {
    const request = requests.start('context')
    const current = threadCurrent(id)
    try {
      const value = await $fetch<VisitorContext>(`/api/conversations/${id}/context`, { signal: request.signal })
      if (request.current() && current()) context.value = value
    } catch (error) {
      if (request.current() && current()) dropInaccessibleThread(error, id)
      // Context is supplementary; changing threads or a failed load cannot block the inbox.
    }
  }
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
    if (filter.value === 'spam') params.set('spam', 'only')
    else if (filter.value !== 'all') params.set('status', filter.value)
    if (assigneeFilter.value !== 'any') params.set('assignee', assigneeFilter.value)
    if (priorityFilters.value.length) params.set('priority', priorityFilters.value.join(','))
    if (tagFilters.value.length) params.set('tag', tagFilters.value.join(','))
    if (snoozedFilter.value !== 'exclude') params.set('snoozed', snoozedFilter.value)
    if (responseFilter.value !== 'all') params.set('response', responseFilter.value)
  }

  function matchesFilters(conversation: InboxItem) {
    if (filter.value === 'spam' ? !conversation.isSpam : conversation.isSpam) return false
    if (filter.value !== 'all' && filter.value !== 'spam' && conversation.status !== filter.value) return false
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
    if (!identity.value || disposed || !requests.active) return
    const seq = ++listSeq
    requests.cancel('more')
    loadingMore.value = false
    const request = requests.start('list')
    if (showLoader) loadingList.value = true
    try {
      const params = new URLSearchParams()
      appendFilters(params)
      const qs = params.size ? `?${params}` : ''
      const data = await $fetch<{ items: InboxItem[], has_more: boolean }>(
        `/api/workspaces/${workspaceId.value}/conversations${qs}`, { signal: request.signal }
      )
      if (!request.current() || seq !== listSeq) return
      conversations.value = data.items
      hasMoreConversations.value = data.has_more
    } catch (error) {
      if (request.current()) throw error
    } finally {
      if (request.current() && seq === listSeq) loadingList.value = false
    }
  }

  async function loadMoreConversations() {
    const last = conversations.value[conversations.value.length - 1]
    if (!identity.value || !last || loadingMore.value || disposed || !requests.active) return
    const seq = listSeq
    const request = requests.start('more')
    loadingMore.value = true
    try {
      const params = new URLSearchParams({ before: last.id })
      appendFilters(params)
      const data = await $fetch<{ items: InboxItem[], has_more: boolean }>(
        `/api/workspaces/${workspaceId.value}/conversations?${params}`, { signal: request.signal }
      )
      if (!request.current() || seq !== listSeq) return
      const known = new Set(conversations.value.map(c => c.id))
      conversations.value.push(...data.items.filter(c => !known.has(c.id)))
      hasMoreConversations.value = data.has_more
    } catch (error) {
      if (request.current()) throw error
    } finally {
      if (request.current()) loadingMore.value = false
    }
  }

  async function loadWorkspaceResource<T>(lane: string, path: string, apply: (value: T) => void) {
    if (!identity.value || disposed || !requests.active) return
    const request = requests.start(lane)
    try {
      const data = await $fetch<T>(`/api/workspaces/${workspaceId.value}/${path}`, { signal: request.signal })
      if (request.current()) apply(data)
    } catch (error) {
      if (request.current()) throw error
    }
  }

  function loadCounts() {
    return loadWorkspaceResource<typeof counts.value>('counts', 'conversation-counts', (data) => {
      counts.value = data
    })
  }

  function loadMembers() {
    return loadWorkspaceResource<TeamMember[]>('members', 'members', (data) => {
      members.value = data
    })
  }

  function loadCanned() {
    return loadWorkspaceResource<CannedResponse[]>('canned', 'canned', (data) => {
      canned.value = data
    })
  }

  function loadSavedViews() {
    return loadWorkspaceResource<InboxSavedView[]>('saved-views', 'saved-views', (data) => {
      savedViews.value = data
    })
  }

  async function select(id: string, opts: { force?: boolean } = {}) {
    if (!identity.value || disposed || !requests.active) return
    if (activeId.value === id && !opts.force) return
    deselect()
    activeId.value = id
    rt.subscribe(channels.conversation(id))
    visitorTyping.value = false
    visitorDraft.value = ''
    messages.value = outbox.pending(id)
    context.value = null
    loadingThread.value = true

    const current = threadCurrent(id)
    const request = requests.start('thread')
    const existingIds = new Set(messages.value.map(message => message.id))
    void loadContext(id)
    try {
      const data = await $fetch<{ items: MessageDTO[], has_more: boolean }>(`/api/conversations/${id}/messages`, { signal: request.signal })
      if (!request.current() || !current()) return
      applyThreadPage(data.items, id, existingIds)
      hasMoreMessages.value = data.has_more
      await $fetch(`/api/conversations/${id}/read`, { method: 'POST' }).catch(() => {})
      if (!request.current() || !current()) return
      const item = conversations.value.find(c => c.id === id)
      if (item) item.unread = false
    } catch (error) {
      if (request.current() && current() && !dropInaccessibleThread(error, id)) throw error
    } finally {
      if (request.current() && current()) loadingThread.value = false
    }
  }

  async function loadOlderMessages() {
    const oldest = messages.value[0]
    const conversationId = activeId.value
    if (!conversationId || !oldest || loadingOlder.value) return
    const current = threadCurrent(conversationId)
    const request = requests.start('older')
    loadingOlder.value = true
    try {
      const data = await $fetch<{ items: MessageDTO[], has_more: boolean }>(
        `/api/conversations/${conversationId}/messages?before=${oldest.id}`, { signal: request.signal }
      )
      if (!request.current() || !current()) return
      for (const message of data.items) outbox.acknowledge(message)
      const olderIds = new Set(data.items.map(message => message.id))
      messages.value = [...data.items, ...messages.value.filter(message => !olderIds.has(message.id))]
      hasMoreMessages.value = data.has_more
    } catch (error) {
      if (request.current() && current() && !dropInaccessibleThread(error, conversationId)) throw error
    } finally {
      if (request.current() && current()) loadingOlder.value = false
    }
  }

  function deselect() {
    threadSeq++
    requests.cancel('thread')
    requests.cancel('older')
    requests.cancel('context')
    if (activeId.value) rt.unsubscribe(channels.conversation(activeId.value))
    activeId.value = null
    messages.value = []
    context.value = null
    loadingThread.value = false
    loadingOlder.value = false
    hasMoreMessages.value = false
    visitorTyping.value = false
    visitorDraft.value = ''
  }

  /* actions */
  function performSend(tempId: string) {
    if (disposed || !requests.active || !identity.value) return Promise.resolve()
    const scope = identity.value
    return outbox.send(tempId, async (temp, clientMessageId) => {
      // An upload can finish after logout or a workspace change. Never send it
      // using the new session's credentials.
      if (scope !== identity.value) throw new Error('Inbox identity changed')
      try {
        const { message } = await $fetch<{ message: MessageDTO }>(`/api/conversations/${temp.conversation_id}/messages`, {
          method: 'POST',
          body: {
            client_message_id: clientMessageId,
            content: temp.content,
            attachment_url: temp.attachment_url ?? undefined,
            attachment_type: temp.attachment_type ?? undefined,
            is_internal_note: temp.is_internal_note,
            mentioned_member_ids: temp.mentioned_member_ids
          }
        })
        return message
      } catch (error) {
        if (requests.active && scope === identity.value) dropInaccessibleThread(error, temp.conversation_id)
        throw error
      }
    })
  }

  async function sendReply(content: string, isInternalNote = false, attachment?: { url: string, type: string }, mentionedMemberIds?: string[]) {
    const text = content.trim()
    if (!activeId.value || !myMemberId.value || !identity.value || disposed || !requests.active || (!text && !attachment)) return
    const tempId = outbox.add({
      conversationId: activeId.value,
      memberId: myMemberId.value,
      content: text,
      internalNote: isInternalNote,
      attachment,
      mentionedMemberIds
    })
    await performSend(tempId)
  }

  /** Optimistic image send: the bubble shows a local preview while uploading. */
  async function sendAttachment(file: File, upload: () => Promise<{ url: string, type: string }>, isInternalNote = false) {
    if (!activeId.value || !myMemberId.value || !identity.value || disposed || !requests.active) return
    const preview = URL.createObjectURL(file)
    const tempId = outbox.add({
      conversationId: activeId.value,
      memberId: myMemberId.value,
      content: '',
      internalNote: isInternalNote,
      attachment: { url: preview, type: file.type },
      upload
    })
    await performSend(tempId)
  }

  function retrySend(tempId: string) {
    if (!activeId.value || !outbox.pending(activeId.value).some(message => message.id === tempId)) return Promise.resolve()
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
  async function markSpam(id: string) {
    const current = requests.capture()
    const result = await $fetch<{ visitor_blocked: boolean }>(`/api/conversations/${id}/spam`, { method: 'POST' })
    if (!current()) return result
    outbox.discardConversation(id)
    if (activeId.value === id) deselect()
    await Promise.all([loadConversations(), loadCounts()])
    return result
  }
  async function restoreSpam(id: string) {
    const current = requests.capture()
    const result = await $fetch<{ visitor_blocked: boolean }>(`/api/conversations/${id}/spam`, { method: 'DELETE' })
    if (!current()) return result
    if (activeId.value === id) deselect()
    await Promise.all([loadConversations(), loadCounts()])
    return result
  }
  async function organize(id: string, changes: { priority?: ConversationPriority, snoozed_until?: string | null }) {
    const current = requests.capture()
    const { conversation } = await $fetch<{ conversation: { priority: ConversationPriority, snoozed_until: string | null } }>(`/api/conversations/${id}/organize`, {
      method: 'PATCH',
      body: changes
    })
    if (!current()) return
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
    const isCurrent = threadCurrent(conversationId)
    requests.cancel('context')
    try {
      const updated = await $fetch<VisitorContext>(`/api/conversations/${conversationId}/customer`, {
        method: 'PATCH',
        body: { ...changes, expected_version: current.visitor.profile_version }
      })
      if (!isCurrent()) return
      context.value = updated
      const inboxItem = conversations.value.find(item => item.id === conversationId)
      if (inboxItem) {
        inboxItem.visitor.name = updated.visitor.name
        inboxItem.visitor.email = updated.visitor.email
      }
      return updated
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 409 && isCurrent()) {
        await loadContext(conversationId)
      }
      throw error
    }
  }

  /* live events */
  function applyEvent(ev: ServerEvent) {
    if (disposed || !requests.active || !identity.value || cachedIdentity.value !== identity.value) return
    switch (ev.type) {
      case 'conversation.new':
        // reload to pick up visitor name + preview + unread in one shot
        loadConversations()
        loadCounts()
        break
      case 'conversation.removed':
        outbox.discardConversation(ev.payload.conversation_id)
        listSeq++
        requests.cancel('list')
        requests.cancel('more')
        loadingList.value = false
        loadingMore.value = false
        conversations.value = conversations.value.filter(conversation => conversation.id !== ev.payload.conversation_id)
        if (activeId.value === ev.payload.conversation_id) deselect()
        loadCounts()
        break
      case 'conversation.refresh':
        loadConversations()
        if (activeId.value === ev.payload.conversation_id) {
          void loadContext(ev.payload.conversation_id)
        }
        break
      case 'conversation.updated': {
        const p = ev.payload
        if (!canSee(p.assigned_agent_id, p.collaborator_member_ids)) {
          outbox.discardConversation(p.id)
          if (activeId.value === p.id) deselect()
        }
        const c = conversations.value.find(x => x.id === p.id)
        if (c) {
          const statusChanged = c.status !== p.status
          c.status = p.status
          c.isSpam = p.is_spam
          c.assignedAgentId = p.assigned_agent_id
          c.collaboratorMemberIds = p.collaborator_member_ids
          c.priority = p.priority
          c.snoozedUntil = p.snoozed_until
          c.lastMessageAt = p.last_message_at

          if (!canSee(p.assigned_agent_id, p.collaborator_member_ids) || !matchesFilters(c)) {
            if (!canSee(p.assigned_agent_id, p.collaborator_member_ids)) outbox.discardConversation(p.id)
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
        outbox.acknowledge(m)
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
    return Promise.allSettled([
      loadConversations({ showLoader: conversations.value.length === 0 }),
      loadCounts(), loadMembers(), loadCanned(), loadTags(), loadSavedViews()
    ])
  }

  // NB: the workspace channel is owned by the dashboard layout (so notifications
  // + presence persist across in-app navigation). Here we only manage the
  // conversation channel for the open thread + the event handler.
  async function refreshActiveThread() {
    const id = activeId.value
    if (!id) return
    const current = threadCurrent(id)
    const request = requests.start('thread')
    const existingIds = new Set(messages.value.map(message => message.id))
    try {
      const data = await $fetch<{ items: MessageDTO[], has_more: boolean }>(`/api/conversations/${id}/messages`, { signal: request.signal })
      if (!request.current() || !current()) return
      applyThreadPage(data.items, id, existingIds)
      hasMoreMessages.value = data.has_more
    } catch (error) {
      if (request.current() && current()) dropInaccessibleThread(error, id)
      // next event or manual select will retry
    } finally {
      if (request.current() && current()) loadingThread.value = false
    }
  }

  /* tags */
  function loadTags() {
    return loadWorkspaceResource<WorkspaceTag[]>('tags', 'tags', (data) => {
      workspaceTags.value = data
    })
  }

  async function applyTag(conversationId: string, tag: WorkspaceTag) {
    const current = requests.capture()
    await $fetch(`/api/conversations/${conversationId}/tags`, { method: 'POST', body: { tag_id: tag.id } })
    if (!current()) return
    const item = conversations.value.find(c => c.id === conversationId)
    if (item && !item.tags.some(t => t.id === tag.id)) {
      item.tags = [...item.tags, tag].sort((a, b) => a.name.localeCompare(b.name))
    }
  }

  async function removeTag(conversationId: string, tagId: string) {
    const current = requests.capture()
    await $fetch(`/api/conversations/${conversationId}/tags/${tagId}`, { method: 'DELETE' })
    if (!current()) return
    const item = conversations.value.find(c => c.id === conversationId)
    if (item) item.tags = item.tags.filter(t => t.id !== tagId)
  }

  async function createTag(name: string): Promise<WorkspaceTag> {
    const current = requests.capture()
    requests.cancel('tags')
    const tag = await $fetch<WorkspaceTag>(`/api/workspaces/${workspaceId.value}/tags`, {
      method: 'POST',
      body: { name }
    })
    if (current() && !workspaceTags.value.some(t => t.id === tag.id)) {
      workspaceTags.value = [...workspaceTags.value, tag].sort((a, b) => a.name.localeCompare(b.name))
    }
    return tag
  }

  async function bulkUpdate(input: BulkConversationInput): Promise<BulkConversationResult> {
    if (!workspaceId.value) throw new Error('No workspace selected')
    const current = requests.capture()
    const result = await $fetch<BulkConversationResult>(`/api/workspaces/${workspaceId.value}/conversations/bulk`, {
      method: 'POST',
      body: input
    })
    if (current()) await Promise.all([loadConversations(), loadCounts()])
    return result
  }

  let offReconnect: (() => void) | undefined
  let snoozeRefresh: ReturnType<typeof setInterval> | undefined
  let mounted = false
  onMounted(() => {
    mounted = true
    rt.connect()
    off = rt.on(applyEvent)
    // the socket was down — anything could have happened; refetch it all
    offReconnect = rt.onReconnect(() => {
      loadAll()
      refreshActiveThread()
    })
    if (workspaceId.value) {
      void loadAll()
    }
    // restore the open thread after navigating away and back
    if (activeId.value) {
      if (messages.value.length) {
        rt.subscribe(channels.conversation(activeId.value))
        refreshActiveThread()
        if (!context.value) {
          void loadContext(activeId.value)
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
    const owned = requests.active
    disposed = true
    requests.dispose()
    offOutbox()
    off?.()
    offReconnect?.()
    if (snoozeRefresh) clearInterval(snoozeRefresh)
    if (owned && activeId.value) rt.unsubscribe(channels.conversation(activeId.value))
  })

  // Include the account, membership and role: switching accounts or losing
  // access must clear the cache even when the workspace id itself is unchanged.
  watch(identity, (next) => {
    if (!requests.active) return
    outbox.setScope(next)
    if (cachedIdentity.value === next) return
    requests.invalidate()
    listSeq++
    deselect()
    cachedIdentity.value = next
    conversations.value = []
    members.value = []
    canned.value = []
    workspaceTags.value = []
    loadingList.value = false
    loadingMore.value = false
    hasMoreConversations.value = false
    counts.value = { unassigned: 0, open: 0, resolved: 0, spam: 0, breached: 0 }
    savedViews.value = []
    filter.value = 'all'
    assigneeFilter.value = 'any'
    priorityFilters.value = []
    tagFilters.value = []
    snoozedFilter.value = 'exclude'
    responseFilter.value = 'all'
    if (next && mounted) void loadAll()
  }, { immediate: true, flush: 'sync' })

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
    const current = requests.capture()
    requests.cancel('saved-views')
    const view = await $fetch<InboxSavedView>(`/api/workspaces/${workspaceId.value}/saved-views`, {
      method: 'POST',
      body: { name, filters: currentSavedFilters() }
    })
    if (current()) savedViews.value = [...savedViews.value, view]
    return view
  }

  async function deleteSavedView(id: string) {
    if (!workspaceId.value) return
    const current = requests.capture()
    requests.cancel('saved-views')
    await $fetch(`/api/workspaces/${workspaceId.value}/saved-views/${id}`, { method: 'DELETE' })
    if (current()) savedViews.value = savedViews.value.filter(view => view.id !== id)
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
    bulkUpdate,
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
    markSpam,
    restoreSpam,
    organize,
    updateCustomerProfile,
    reload: loadConversations
  }
}
