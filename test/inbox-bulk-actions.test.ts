import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_BULK_CONVERSATIONS } from '@perch/shared'
import { useInboxBulkActions } from '@/composables/useInboxBulkActions'
import type { BulkConversationInput, BulkConversationResult, InboxFilter, InboxItem, WorkspaceTag } from '@/composables/useControlRoom'

const { ref, computed, watch, effectScope, nextTick }: typeof import('vue') = createRequire(import.meta.resolve('nuxt/package.json'))('vue')
const cleanups: Array<() => void> = []

function conversation(id: string, isSpam = false, tags: WorkspaceTag[] = []): InboxItem {
  return {
    id, isSpam, tags, status: 'open', assignedAgentId: null, collaboratorMemberIds: [],
    priority: 'normal', snoozedUntil: null, lastMessageAt: '', createdAt: '', preview: '', unread: false,
    responseSla: { status: 'answered', due_at: null, started_at: null, approaching_at: null, paused_until: null, target_minutes: 60 },
    visitor: { id, name: id, email: null, visitorId: id }
  }
}

function harness(items = [conversation('a'), conversation('b')]) {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  const toast = vi.fn()
  vi.stubGlobal('useToast', () => ({ add: toast }))
  const conversations = ref(items)
  const workspaceTags = ref<WorkspaceTag[]>([])
  const filter = ref<InboxFilter>('all')
  const searchActive = ref(false)
  const workspace = ref('one')
  const bulkUpdate = vi.fn(async (input: BulkConversationInput): Promise<BulkConversationResult> => ({
    action: input.action, requested_count: input.conversation_ids.length,
    changed_count: input.conversation_ids.length, unchanged_count: 0
  }))
  const scope = effectScope()
  const actions = scope.run(() => useInboxBulkActions({
    inbox: { conversations, workspaceTags, filter, bulkUpdate }, searchActive,
    workspaceId: () => workspace.value
  }))!
  cleanups.push(() => scope.stop())
  actions.setSelectionMode(true)
  return { actions, conversations, workspaceTags, filter, searchActive, workspace, bulkUpdate, toast }
}

afterEach(() => {
  cleanups.splice(0).forEach(stop => stop())
  vi.unstubAllGlobals()
})

describe('inbox bulk selection', () => {
  it('tracks partial, full and cleared page selection', () => {
    const { actions } = harness()
    actions.toggleConversationSelection('a')
    expect(actions.somePageSelected.value).toBe(true)
    expect(actions.allPageSelected.value).toBe(false)
    actions.toggleCurrentPage()
    expect(actions.selectedCount.value).toBe(2)
    expect(actions.allPageSelected.value).toBe(true)
    actions.toggleCurrentPage()
    expect(actions.selectedCount.value).toBe(0)
  })

  it('excludes spam and unknown conversations and enforces the batch limit', () => {
    const { actions } = harness([
      conversation('spam', true),
      ...Array.from({ length: MAX_BULK_CONVERSATIONS + 1 }, (_, i) => conversation(String(i)))
    ])
    actions.toggleConversationSelection('missing')
    actions.toggleConversationSelection('spam')
    expect(actions.selectedCount.value).toBe(0)
    actions.toggleCurrentPage()
    expect(actions.selectedCount.value).toBe(MAX_BULK_CONVERSATIONS)
    actions.toggleConversationSelection(String(MAX_BULK_CONVERSATIONS))
    expect(actions.selectedCount.value).toBe(MAX_BULK_CONVERSATIONS)
  })

  it('drops selection when an item leaves the page or becomes spam', async () => {
    const { actions, conversations } = harness()
    actions.toggleCurrentPage()
    conversations.value = [conversation('a', true), conversation('c')]
    await nextTick()
    expect(actions.selectedCount.value).toBe(0)
  })

  it.each(['search', 'spam', 'workspace'] as const)('clears pending confirmation when entering %s', async (change) => {
    const h = harness()
    h.actions.toggleCurrentPage()
    h.actions.queueBulkResolve()
    if (change === 'search') h.searchActive.value = true
    if (change === 'spam') h.filter.value = 'spam'
    if (change === 'workspace') h.workspace.value = 'two'
    await nextTick()
    expect(h.actions.selectionMode.value).toBe(false)
    expect(h.actions.pendingBulkAction.value).toBeNull()
    await h.actions.confirmBulkAction()
    expect(h.bulkUpdate).not.toHaveBeenCalled()
  })

  it('only offers applied tags for removal', () => {
    const tag = { id: 'tag', name: 'Customer' }
    const h = harness([conversation('a', false, [tag]), conversation('b')])
    h.workspaceTags.value = [tag, { id: 'other', name: 'Other' }]
    h.actions.toggleConversationSelection('a')
    h.actions.bulkTagMode.value = 'remove_tag'
    expect(h.actions.bulkTagOptions.value).toEqual([tag])
  })
})

describe('inbox bulk submissions', () => {
  it('preserves a failed selection and confirmation for retry', async () => {
    const h = harness()
    h.actions.toggleCurrentPage()
    h.actions.queueBulkResolve()
    h.bulkUpdate.mockRejectedValueOnce(new Error('Please retry'))
    await h.actions.confirmBulkAction()
    expect(h.actions.pendingBulkAction.value).not.toBeNull()
    expect(h.actions.selectedCount.value).toBe(2)
    expect(h.actions.bulkWorking.value).toBe(false)
    await h.actions.confirmBulkAction()
    expect(h.bulkUpdate).toHaveBeenLastCalledWith({ action: 'resolve', conversation_ids: ['a', 'b'] })
    expect(h.actions.pendingBulkAction.value).toBeNull()
    expect(h.actions.selectedCount.value).toBe(0)
  })

  it('does not submit twice while a confirmation is in flight', async () => {
    const h = harness()
    let complete!: (result: BulkConversationResult) => void
    h.bulkUpdate.mockImplementationOnce(() => new Promise((resolve) => {
      complete = resolve
    }))
    h.actions.toggleCurrentPage()
    h.actions.queueBulkAssign('member', 'Ada')
    const first = h.actions.confirmBulkAction()
    await h.actions.confirmBulkAction()
    expect(h.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(h.actions.pendingBulkAction.value).not.toBeNull()
    complete({ action: 'assign', requested_count: 2, changed_count: 2, unchanged_count: 0 })
    await first
    expect(h.actions.pendingBulkAction.value).toBeNull()
  })

  it.each([false, true])('does not clear a newer selection after switching workspaces (returning: %s)', async (returning) => {
    const h = harness()
    let complete!: (result: BulkConversationResult) => void
    h.bulkUpdate.mockImplementationOnce(() => new Promise((resolve) => {
      complete = resolve
    }))
    h.actions.toggleCurrentPage()
    h.actions.queueBulkResolve()
    const pending = h.actions.confirmBulkAction()
    h.workspace.value = 'two'
    if (returning) h.workspace.value = 'one'
    h.conversations.value = [conversation('new')]
    await nextTick()
    h.actions.setSelectionMode(true)
    h.actions.toggleConversationSelection('new')
    complete({ action: 'resolve', requested_count: 2, changed_count: 2, unchanged_count: 0 })
    await pending
    expect([...h.actions.selectedIds.value]).toEqual(['new'])
    expect(h.toast).not.toHaveBeenCalled()
  })
})
