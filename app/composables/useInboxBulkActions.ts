import { MAX_BULK_CONVERSATIONS } from '@perch/shared'
import type { Ref } from 'vue'
import type { BulkConversationInput, useControlRoom } from '@/composables/useControlRoom'
import { getErrorMessage } from '@/utils/errors'

interface InboxBulkActionsOptions {
  inbox: Pick<ReturnType<typeof useControlRoom>, 'conversations' | 'workspaceTags' | 'filter' | 'bulkUpdate'>
  searchActive: Ref<boolean>
  workspaceId: () => string | undefined
}

export function useInboxBulkActions({ inbox, searchActive, workspaceId }: InboxBulkActionsOptions) {
  const toast = useToast()
  let workspaceRevision = 0
  const selectionMode = ref(false)
  const selectedIds = ref<Set<string>>(new Set())
  const bulkWorking = ref(false)
  const bulkTagOpen = ref(false)
  const bulkAssignOpen = ref(false)
  const bulkTagMode = ref<'add_tag' | 'remove_tag'>('add_tag')
  const pendingBulkAction = ref<{
    input: BulkConversationInput
    title: string
    description: string
    confirmLabel: string
  } | null>(null)

  const selectedCount = computed(() => selectedIds.value.size)
  const selectablePageIds = computed(() => inbox.conversations.value
    .filter(conversation => !conversation.isSpam)
    .slice(0, MAX_BULK_CONVERSATIONS)
    .map(conversation => conversation.id))
  const allPageSelected = computed(() => selectablePageIds.value.length > 0 && selectablePageIds.value.every(id => selectedIds.value.has(id)))
  const somePageSelected = computed(() => !allPageSelected.value && selectablePageIds.value.some(id => selectedIds.value.has(id)))
  const selectedConversations = computed(() => inbox.conversations.value.filter(conversation => selectedIds.value.has(conversation.id)))

  const bulkTagOptions = computed(() => bulkTagMode.value === 'add_tag'
    ? inbox.workspaceTags.value
    : inbox.workspaceTags.value.filter(tag => selectedConversations.value.some(conversation => conversation.tags.some(applied => applied.id === tag.id))))

  function setSelectionMode(enabled: boolean) {
    selectionMode.value = enabled
    selectedIds.value = new Set()
    bulkTagOpen.value = false
    bulkAssignOpen.value = false
    pendingBulkAction.value = null
  }

  function toggleConversationSelection(id: string) {
    const conversation = inbox.conversations.value.find(conversation => conversation.id === id)
    if (!conversation) return
    if (conversation.isSpam) {
      toast.add({
        title: 'Restore spam conversations individually',
        description: 'This keeps visitor unblocking explicit and prevents accidental bulk changes.',
        color: 'neutral'
      })
      return
    }
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else if (next.size < MAX_BULK_CONVERSATIONS) next.add(id)
    else {
      toast.add({ title: `You can update up to ${MAX_BULK_CONVERSATIONS} conversations at once`, color: 'neutral' })
    }
    selectedIds.value = next
  }

  function toggleCurrentPage() {
    const selecting = !allPageSelected.value
    selectedIds.value = selecting ? new Set(selectablePageIds.value) : new Set()
    if (selecting && inbox.conversations.value.filter(conversation => !conversation.isSpam).length > MAX_BULK_CONVERSATIONS) {
      toast.add({
        title: `Selected the first ${MAX_BULK_CONVERSATIONS} conversations`,
        description: 'Finish this batch, then select the remaining conversations.',
        color: 'neutral'
      })
    }
  }

  watch(() => inbox.conversations.value.filter(conversation => !conversation.isSpam).map(conversation => conversation.id), (ids) => {
    const visible = new Set(ids)
    selectedIds.value = new Set([...selectedIds.value].filter(id => visible.has(id)))
  })
  watch(searchActive, (active) => {
    if (active) setSelectionMode(false)
  })
  watch(() => inbox.filter.value, (filter) => {
    if (filter === 'spam') setSelectionMode(false)
  })

  async function runBulkAction(input: BulkConversationInput, successLabel: string): Promise<void> {
    if (!input.conversation_ids.length || bulkWorking.value) return
    const revision = workspaceRevision
    bulkWorking.value = true
    try {
      const result = await inbox.bulkUpdate(input)
      if (revision !== workspaceRevision) return
      const unchanged = result.unchanged_count
        ? `${result.unchanged_count} already matched and needed no change.`
        : undefined
      toast.add({
        title: result.changed_count
          ? `${successLabel} ${result.changed_count} conversation${result.changed_count === 1 ? '' : 's'}`
          : 'No changes needed',
        description: unchanged,
        color: 'success',
        icon: 'i-lucide-check-check'
      })
      setSelectionMode(false)
    } catch (error) {
      if (revision !== workspaceRevision) return
      toast.add({
        title: getErrorMessage(error, 'Could not update the selected conversations'),
        description: 'We could not confirm the result. Refresh the inbox before retrying.',
        color: 'error'
      })
    } finally {
      bulkWorking.value = false
    }
  }

  function queueBulkAssign(memberId: string, memberName: string) {
    if (!selectedCount.value || bulkWorking.value) return
    bulkAssignOpen.value = false
    pendingBulkAction.value = {
      input: { action: 'assign', conversation_ids: [...selectedIds.value], member_id: memberId },
      title: `Assign ${selectedCount.value} conversation${selectedCount.value === 1 ? '' : 's'} to ${memberName}?`,
      description: 'Resolved conversations will be reopened and snoozed conversations will return to the inbox.',
      confirmLabel: `Assign to ${memberName}`
    }
  }

  function queueBulkResolve() {
    if (!selectedCount.value || bulkWorking.value) return
    pendingBulkAction.value = {
      input: { action: 'resolve', conversation_ids: [...selectedIds.value] },
      title: `Resolve ${selectedCount.value} conversation${selectedCount.value === 1 ? '' : 's'}?`,
      description: 'Visitors can still reply later. A new reply will return the conversation to the inbox.',
      confirmLabel: 'Resolve selected'
    }
  }

  async function confirmBulkAction() {
    const pending = pendingBulkAction.value
    if (!pending) return
    await runBulkAction(pending.input, pending.input.action === 'assign' ? 'Assigned' : 'Resolved')
  }

  function applyBulkTag(tagId: string) {
    bulkTagOpen.value = false
    runBulkAction({ action: bulkTagMode.value, conversation_ids: [...selectedIds.value], tag_id: tagId }, bulkTagMode.value === 'add_tag' ? 'Tagged' : 'Updated')
  }

  function reopenSelected() {
    runBulkAction({ action: 'reopen', conversation_ids: [...selectedIds.value] }, 'Reopened')
  }

  watch(workspaceId, () => {
    workspaceRevision++
    setSelectionMode(false)
  }, { flush: 'sync' })

  return {
    selectionMode, selectedIds, selectedCount, selectablePageIds, allPageSelected, somePageSelected,
    bulkWorking, bulkTagOpen, bulkAssignOpen, bulkTagMode, bulkTagOptions,
    pendingBulkAction, setSelectionMode, toggleConversationSelection,
    toggleCurrentPage, queueBulkAssign, queueBulkResolve, confirmBulkAction,
    applyBulkTag, reopenSelected
  }
}
