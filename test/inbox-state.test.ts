import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessageDTO, ServerEvent } from '@perch/shared'
import type { AuthUser, Membership } from '../app/composables/useAuth'
import { useControlRoom } from '../app/composables/useControlRoom'
import type { VisitorContext } from '../app/composables/useControlRoom'
import { InboxOutbox, inboxOutboxFor } from '../app/utils/inbox-outbox'

const { ref, computed, watch, effectScope, nextTick }: typeof import('vue') = createRequire(import.meta.resolve('nuxt/package.json'))('vue')

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function message(id: string, conversationId = 'a'): MessageDTO {
  return {
    id, conversation_id: conversationId, sender_type: 'agent', sender_id: 'member-a',
    content: id, attachment_url: null, attachment_type: null, is_internal_note: false,
    mentioned_member_ids: [], created_at: '2026-09-05T10:00:00.000Z'
  }
}

function membership(id: string): Membership {
  return { workspaceId: id, memberId: `member-${id}`, role: 'admin', workspaceName: id, siteId: id, attachmentsAvailable: true }
}

function customer(name: string): VisitorContext {
  return {
    visitor: {
      name, email: null, profile_name: name, profile_email: null, reported_name: null, reported_email: null,
      company: null, job_title: null, internal_note: null, profile_version: 1, tags: [], visitor_id: name,
      external_id: null, identity_verified: false, messaging_blocked: false,
      reply_email: { eligible: false, status: null, cancel_reason: null },
      first_seen_at: '', last_seen_at: '', page_url: null, browser: null, os: null
    },
    conversation: { created_at: '', status: 'open', resolved_at: null }, past_conversations: 0, recent_conversations: []
  }
}

interface FetchOptions {
  method?: string
  signal?: AbortSignal
  body?: Record<string, unknown>
}

const cleanups: Array<() => void> = []

function harness() {
  const workspace = ref<Membership | null>(membership('a'))
  const user = ref<AuthUser | null>({ id: 'user-a', email: 'a@example.test', name: 'A', emailVerified: true, hasPassword: true })
  const states = new Map<string, ReturnType<typeof ref>>()
  const handlers = new Map<string, (options: FetchOptions) => unknown>()
  const mounted: Array<() => void> = []
  const unmounted: Array<() => void> = []
  const listeners = new Set<(event: ServerEvent) => void>()
  const reconnect = new Set<() => void>()
  const app = {}
  const realtime = {
    status: ref('open'), connect: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(),
    on: (listener: (event: ServerEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onReconnect: (listener: () => void) => {
      reconnect.add(listener)
      return () => reconnect.delete(listener)
    }
  }
  const fetch = vi.fn(async (url: string, options: FetchOptions = {}) => {
    const handler = handlers.get(`${options.method ?? 'GET'} ${url}`)
    if (handler) return handler(options)
    if (url.endsWith('/conversation-counts')) return { unassigned: 0, open: 0, resolved: 0, spam: 0, breached: 0 }
    if (url.includes('/context')) return customer(url.split('/')[3]!)
    if (url.includes('/messages') || url.includes('/conversations')) return { items: [], has_more: false }
    return []
  })
  vi.stubGlobal('$fetch', fetch)
  vi.stubGlobal('useAuth', () => ({ currentWorkspace: workspace, user }))
  vi.stubGlobal('useNuxtApp', () => app)
  vi.stubGlobal('useRealtime', () => realtime)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useState', (key: string, initial: () => unknown) => {
    if (!states.has(key)) states.set(key, ref(initial()))
    return states.get(key)
  })
  vi.stubGlobal('onMounted', (callback: () => void) => mounted.push(callback))
  vi.stubGlobal('onBeforeUnmount', (callback: () => void) => unmounted.push(callback))
  const scope = effectScope()
  const inbox = scope.run(useControlRoom)!
  const initialUnmount = [...unmounted]
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    for (const callback of initialUnmount) callback()
    scope.stop()
  }
  cleanups.push(stop)
  return {
    inbox, workspace, user, handlers, fetch, app, realtime, states,
    mount: () => mounted.forEach(callback => callback()), stop,
    nextInstance: () => {
      const mountOffset = mounted.length
      const unmountOffset = unmounted.length
      const nextScope = effectScope()
      const nextInbox = nextScope.run(useControlRoom)!
      cleanups.push(() => {
        for (const callback of unmounted.slice(unmountOffset)) callback()
        nextScope.stop()
      })
      return { inbox: nextInbox, mount: () => mounted.slice(mountOffset).forEach(callback => callback()) }
    },
    emit: (event: ServerEvent) => listeners.forEach(listener => listener(event)),
    reconnect: () => reconnect.forEach(listener => listener())
  }
}

async function settle() {
  await nextTick()
  await new Promise(resolve => setImmediate(resolve))
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('inbox request ownership', () => {
  it('does not append a delayed send from A to the selected conversation B', async () => {
    const h = harness()
    const send = deferred<{ message: MessageDTO }>()
    h.handlers.set('POST /api/conversations/a/messages', () => send.promise)
    await h.inbox.select('a')
    const sending = h.inbox.sendReply('For customer A', true, undefined, ['mentioned-agent'])
    await settle()
    const body = h.fetch.mock.calls.find(([url, options]) => url.endsWith('/a/messages') && options?.method === 'POST')![1]!.body!
    expect(body.client_message_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.mentioned_member_ids).toEqual(['mentioned-agent'])
    await h.inbox.select('b')
    send.resolve({ message: message('sent-a') })
    await sending
    expect(h.inbox.activeId.value).toBe('b')
    expect(h.inbox.messages.value).toEqual([])
  })

  it('reconciles a websocket echo without duplicate messages', async () => {
    const h = harness()
    h.mount()
    const send = deferred<{ message: MessageDTO }>()
    h.handlers.set('POST /api/conversations/a/messages', () => send.promise)
    await h.inbox.select('a')
    const sending = h.inbox.sendReply('Hello')
    await settle()
    h.emit({ type: 'message.new', payload: message('sent-a') })
    send.resolve({ message: message('sent-a') })
    await sending
    expect(h.inbox.messages.value.map(item => item.id)).toEqual(['sent-a'])
  })

  it('shares concurrent retries and retains the original idempotency key and mentions', async () => {
    const h = harness()
    const retry = deferred<{ message: MessageDTO }>()
    let attempts = 0
    h.handlers.set('POST /api/conversations/a/messages', () => {
      if (++attempts === 1) throw new Error('Response lost')
      return retry.promise
    })
    await h.inbox.select('a')
    await h.inbox.sendReply('Note', true, undefined, ['teammate'])
    const failed = h.inbox.messages.value[0]!
    expect(failed.failed).toBe(true)
    await h.inbox.select('b')
    await h.inbox.select('a')
    expect(h.inbox.messages.value[0]?.id).toBe(failed.id)
    const firstRetry = h.inbox.retrySend(failed.id)
    const secondRetry = h.inbox.retrySend(failed.id)
    await settle()
    expect(attempts).toBe(2)
    retry.resolve({ message: message('retried') })
    await Promise.all([firstRetry, secondRetry])
    const bodies = h.fetch.mock.calls.filter(([url, options]) => url.endsWith('/a/messages') && options?.method === 'POST').map(([, options]) => options!.body!)
    expect(bodies[0]).toEqual(bodies[1])
    expect(h.inbox.messages.value.map(item => item.id)).toEqual(['retried'])
  })

  it.each(['b', null])('rejects stale resource responses after switching workspace to %s', async (next) => {
    const h = harness()
    const paths = ['members', 'canned', 'tags', 'saved-views', 'conversation-counts', 'conversations']
    const pending = paths.map((path) => {
      const request = deferred<unknown>()
      h.handlers.set(`GET /api/workspaces/a/${path}`, () => request.promise)
      return request
    })
    h.mount()
    h.workspace.value = next ? membership(next) : null
    await settle()
    pending.forEach((request, index) => request.resolve(index === 4
      ? { unassigned: 99, open: 99, resolved: 99, spam: 99, breached: 99 }
      : index === 5 ? { items: [{ id: 'stale' }], has_more: true } : [{ id: 'stale' }]))
    await settle()
    expect(h.inbox.members.value).toEqual([])
    expect(h.inbox.canned.value).toEqual([])
    expect(h.inbox.workspaceTags.value).toEqual([])
    expect(h.inbox.savedViews.value).toEqual([])
    expect(h.inbox.conversations.value).toEqual([])
    expect(h.inbox.counts.value.open).toBe(0)
    expect(h.inbox.hasMoreConversations.value).toBe(false)
    expect(h.fetch.mock.calls.filter(([url]) => url.startsWith('/api/workspaces/a/')).every(([, options]) => options?.signal?.aborted)).toBe(true)
  })

  it('rejects an older response from the same workspace after a newer refresh', async () => {
    const h = harness()
    const old = deferred<unknown>()
    let requests = 0
    h.handlers.set('GET /api/workspaces/a/members', () => ++requests === 1 ? old.promise : [{ id: 'new-member' }])
    h.mount()
    h.reconnect()
    await settle()
    old.resolve([{ id: 'old-member' }])
    await settle()
    expect(h.inbox.members.value).toEqual([{ id: 'new-member' }])
  })

  it('clears caches and pending replies when the member or account changes in the same workspace', async () => {
    const h = harness()
    h.handlers.set('POST /api/conversations/a/messages', () => {
      throw new Error('Offline')
    })
    await h.inbox.select('a')
    await h.inbox.sendReply('Private note')
    const failedId = h.inbox.messages.value[0]!.id
    h.inbox.members.value = [{ id: 'old', name: 'Old', role: 'agent', presence: 'online' }]
    h.workspace.value = { ...membership('a'), memberId: 'replacement-member' }
    expect(h.inbox.members.value).toEqual([])
    expect(h.inbox.activeId.value).toBeNull()
    await h.inbox.select('a')
    await h.inbox.retrySend(failedId)
    expect(h.inbox.messages.value).toEqual([])
    expect(h.fetch.mock.calls.filter(([, options]) => options?.method === 'POST' && options.body?.content === 'Private note')).toHaveLength(1)
    h.inbox.context.value = customer('private')
    h.user.value = { ...h.user.value!, id: 'new-user' }
    expect(h.inbox.context.value).toBeNull()
  })

  it.each(['deselect', 'unmount', 'revoke'] as const)('invalidates pending thread and context reads on %s', async (action) => {
    const h = harness()
    const thread = deferred<{ items: MessageDTO[], has_more: boolean }>()
    const context = deferred<VisitorContext>()
    h.handlers.set('GET /api/conversations/a/messages', () => thread.promise)
    h.handlers.set('GET /api/conversations/a/context', () => context.promise)
    h.mount()
    const selecting = h.inbox.select('a')
    if (action === 'deselect') h.inbox.deselect()
    else if (action === 'unmount') h.stop()
    else h.emit({ type: 'conversation.removed', payload: { conversation_id: 'a' } })
    thread.resolve({ items: [message('private')], has_more: true })
    context.resolve(customer('private'))
    await selecting
    await settle()
    expect(h.inbox.messages.value).toEqual([])
    expect(h.inbox.context.value).toBeNull()
    expect(h.inbox.hasMoreMessages.value).toBe(false)
    expect(h.fetch.mock.calls.some(([url]) => url.endsWith('/read'))).toBe(false)
  })

  it('does not apply a delayed profile-conflict refresh after another customer is selected', async () => {
    const h = harness()
    await h.inbox.select('a')
    const refresh = deferred<VisitorContext>()
    h.handlers.set('PATCH /api/conversations/a/customer', () => {
      throw Object.assign(new Error('Conflict'), { statusCode: 409 })
    })
    h.handlers.set('GET /api/conversations/a/context', () => refresh.promise)
    const update = h.inbox.updateCustomerProfile({ name: 'new' }).catch(error => error)
    await settle()
    await h.inbox.select('b')
    refresh.resolve(customer('stale-a'))
    await update
    expect(h.inbox.context.value?.visitor.name).toBe('b')
  })

  it('guards refresh-event context and remounted context loads after switching threads', async () => {
    const h = harness()
    await h.inbox.select('a')
    h.inbox.messages.value = [message('existing')]
    h.inbox.context.value = null
    const old = deferred<VisitorContext>()
    h.handlers.set('GET /api/conversations/a/context', () => old.promise)
    h.mount()
    h.emit({ type: 'conversation.refresh', payload: { conversation_id: 'a' } })
    await h.inbox.select('b')
    old.resolve(customer('stale-a'))
    await settle()
    expect(h.inbox.context.value?.visitor.name).toBe('b')
  })

  it('keeps a newer mount in control even before the previous page finishes unmounting', async () => {
    const h = harness()
    const old = deferred<unknown>()
    let reads = 0
    h.handlers.set('GET /api/workspaces/a/members', () => ++reads === 1 ? old.promise : [{ id: 'new' }])
    h.mount()
    const next = h.nextInstance()
    next.mount()
    await next.inbox.select('b')
    await settle()
    old.resolve([{ id: 'old' }])
    await settle()
    expect(next.inbox.members.value).toEqual([{ id: 'new' }])
    h.realtime.unsubscribe.mockClear()
    h.stop()
    expect(h.realtime.unsubscribe).not.toHaveBeenCalled()
  })

  it('preserves image retries across a page unmount and remount without another upload', async () => {
    const h = harness()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const upload = vi.fn().mockResolvedValue({ url: 'https://cdn.example.test/photo.png', type: 'image/png' })
    let sends = 0
    h.handlers.set('POST /api/conversations/a/messages', () => {
      if (++sends === 1) throw new Error('Response lost')
      return { message: message('image') }
    })
    await h.inbox.select('a')
    await h.inbox.sendAttachment(new File(['image'], 'image.png', { type: 'image/png' }), upload)
    const failedId = h.inbox.messages.value[0]!.id
    h.stop()
    const next = h.nextInstance()
    next.mount()
    await settle()
    expect(next.inbox.messages.value[0]?.id).toBe(failedId)
    await next.inbox.retrySend(failedId)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:preview')
    expect(next.inbox.messages.value.map(item => item.id)).toEqual(['image'])
  })

  it('does not let a delayed page of older messages contaminate another thread', async () => {
    const h = harness()
    await h.inbox.select('a')
    h.inbox.messages.value = [message('recent-a')]
    const older = deferred<{ items: MessageDTO[], has_more: boolean }>()
    h.handlers.set('GET /api/conversations/a/messages?before=recent-a', () => older.promise)
    const loading = h.inbox.loadOlderMessages()
    await h.inbox.select('b')
    older.resolve({ items: [message('older-a')], has_more: true })
    await loading
    expect(h.inbox.messages.value).toEqual([])
    expect(h.inbox.hasMoreMessages.value).toBe(false)
    expect(h.inbox.loadingOlder.value).toBe(false)
  })

  it('clears inaccessible messages and retries when the API rejects current thread access', async () => {
    const h = harness()
    await h.inbox.select('a')
    h.handlers.set('POST /api/conversations/a/messages', () => {
      throw Object.assign(new Error('Access removed'), { statusCode: 403 })
    })
    await h.inbox.sendReply('Private')
    expect(h.inbox.activeId.value).toBeNull()
    expect(h.inbox.messages.value).toEqual([])
    expect(inboxOutboxFor(h.app).pending('a')).toEqual([])
  })

  it('finishes the thread loading state when reconnect supersedes an initial request', async () => {
    const h = harness()
    const old = deferred<{ items: MessageDTO[], has_more: boolean }>()
    let reads = 0
    h.handlers.set('GET /api/conversations/a/messages', () => ++reads === 1 ? old.promise : { items: [message('fresh')], has_more: false })
    h.mount()
    const selecting = h.inbox.select('a')
    expect(h.inbox.loadingThread.value).toBe(true)
    h.reconnect()
    await settle()
    old.resolve({ items: [message('stale')], has_more: true })
    await selecting
    expect(h.inbox.messages.value.map(item => item.id)).toEqual(['fresh'])
    expect(h.inbox.loadingThread.value).toBe(false)
  })
})

describe('inbox image outbox', () => {
  it('preserves a failed upload for navigation retries and releases the preview once uploaded', async () => {
    const outbox = new InboxOutbox()
    outbox.setScope('user:workspace:member')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const upload = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ url: 'https://cdn.example.test/image.png', type: 'image/png' })
    const id = outbox.add({ conversationId: 'a', memberId: 'agent', content: '', internalNote: false, attachment: { url: 'blob:preview', type: 'image/png' }, upload })
    const deliver = vi.fn().mockResolvedValue(message('sent'))
    await outbox.send(id, deliver)
    expect(outbox.pending('a')[0]?.failed).toBe(true)
    expect(revoke).not.toHaveBeenCalled()
    outbox.setScope('user:workspace:member')
    await outbox.send(id, deliver)
    expect(upload).toHaveBeenCalledTimes(2)
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:preview')
    expect(outbox.pending('a')).toEqual([])
  })

  it.each(['scope', 'access'] as const)('does not send a finished upload after %s is lost', async (change) => {
    const outbox = new InboxOutbox()
    outbox.setScope('user:workspace:member')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const upload = deferred<{ url: string, type: string }>()
    const id = outbox.add({ conversationId: 'a', memberId: 'agent', content: '', internalNote: false, attachment: { url: 'blob:preview', type: 'image/png' }, upload: () => upload.promise })
    const deliver = vi.fn().mockResolvedValue(message('sent'))
    const sending = outbox.send(id, deliver)
    await settle()
    if (change === 'scope') outbox.setScope('other-user:workspace:member')
    else outbox.discardConversation('a')
    upload.resolve({ url: 'https://cdn.example.test/image.png', type: 'image/png' })
    await sending
    expect(deliver).not.toHaveBeenCalled()
    expect(outbox.pending('a')).toEqual([])
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:preview')
  })

  it('does not share retry metadata between Nuxt apps', () => {
    const app = {}
    expect(inboxOutboxFor(app)).toBe(inboxOutboxFor(app))
    expect(inboxOutboxFor(app)).not.toBe(inboxOutboxFor({}))
  })
})
