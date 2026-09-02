<script setup lang="ts">
import { MAX_BULK_CONVERSATIONS } from '@perch/shared'
import type { ConversationPriority } from '@perch/shared'
import type { BulkConversationInput, InboxFilter, InboxSavedView } from '~/composables/useControlRoom'

definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Inbox · Perch' })

const toast = useToast()
const route = useRoute()
const cr = useControlRoom()
const { currentWorkspace } = useAuth()
const { enabled: soundEnabled, toggle: toggleSound } = useNotificationSound()
const filterOpen = ref(false)
const savedViewsOpen = ref(false)
const newViewName = ref('')
const savingView = ref(false)
const snoozeOpen = ref(false)
const customSnooze = ref('')
const slaNow = ref(new Date())
let slaClock: ReturnType<typeof setInterval> | undefined

const filters: { label: string, value: InboxFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Unassigned', value: 'unassigned' },
  { label: 'Open', value: 'open' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Spam', value: 'spam' }
]

const priorities: { value: ConversationPriority, label: string, icon: string }[] = [
  { value: 'urgent', label: 'Urgent', icon: 'i-lucide-siren' },
  { value: 'high', label: 'High', icon: 'i-lucide-chevrons-up' },
  { value: 'normal', label: 'Normal', icon: 'i-lucide-minus' },
  { value: 'low', label: 'Low', icon: 'i-lucide-chevrons-down' }
]

const assigneeOptions = computed(() => [
  { value: 'any', label: 'Anyone' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'me', label: 'Assigned to me' },
  ...(currentWorkspace.value?.role === 'admin'
    ? cr.members.value.map(member => ({ value: member.id, label: member.name }))
    : [])
])

const activeAdvancedFilters = computed(() =>
  (cr.assigneeFilter.value !== 'any' ? 1 : 0)
  + cr.priorityFilters.value.length
  + cr.tagFilters.value.length
  + (cr.snoozedFilter.value !== 'exclude' ? 1 : 0)
)

function togglePriorityFilter(priority: ConversationPriority) {
  cr.priorityFilters.value = cr.priorityFilters.value.includes(priority)
    ? cr.priorityFilters.value.filter(value => value !== priority)
    : [...cr.priorityFilters.value, priority]
}

function toggleTagFilter(tagId: string) {
  cr.tagFilters.value = cr.tagFilters.value.includes(tagId)
    ? cr.tagFilters.value.filter(value => value !== tagId)
    : [...cr.tagFilters.value, tagId]
}

function clearAdvancedFilters() {
  cr.assigneeFilter.value = 'any'
  cr.priorityFilters.value = []
  cr.tagFilters.value = []
  cr.snoozedFilter.value = 'exclude'
  cr.responseFilter.value = 'all'
}

onMounted(() => {
  slaClock = setInterval(() => {
    slaNow.value = new Date()
  }, 30_000)
})
onBeforeUnmount(() => {
  if (slaClock) clearInterval(slaClock)
})

function applySavedView(view: InboxSavedView) {
  cr.applySavedView(view)
  savedViewsOpen.value = false
}

async function saveView() {
  const name = newViewName.value.trim()
  if (!name || savingView.value) return
  savingView.value = true
  try {
    await cr.saveCurrentView(name)
    newViewName.value = ''
    toast.add({ title: 'View saved', color: 'success', icon: 'i-lucide-bookmark-check' })
  } catch (error) {
    toast.add({ title: getErrorMessage(error, 'Could not save view'), color: 'error' })
  } finally {
    savingView.value = false
  }
}

async function removeSavedView(id: string) {
  try {
    await cr.deleteSavedView(id)
  } catch (error) {
    toast.add({ title: getErrorMessage(error, 'Could not delete view'), color: 'error' })
  }
}

/* inbox search (visitor name/email or message text) */
const {
  query: searchQuery,
  results: searchResults,
  searching,
  active: searchActive
} = useConversationSearch(() => currentWorkspace.value?.workspaceId)

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
const pageConversationIds = computed(() => cr.conversations.value.map(conversation => conversation.id))
const selectablePageIds = computed(() => cr.conversations.value
  .filter(conversation => !conversation.isSpam)
  .slice(0, MAX_BULK_CONVERSATIONS)
  .map(conversation => conversation.id))
const allPageSelected = computed(() => selectablePageIds.value.length > 0 && selectablePageIds.value.every(id => selectedIds.value.has(id)))
const somePageSelected = computed(() => !allPageSelected.value && selectablePageIds.value.some(id => selectedIds.value.has(id)))
const selectedConversations = computed(() => cr.conversations.value.filter(conversation => selectedIds.value.has(conversation.id)))

const bulkTagOptions = computed(() => bulkTagMode.value === 'add_tag'
  ? cr.workspaceTags.value
  : cr.workspaceTags.value.filter(tag => selectedConversations.value.some(conversation => conversation.tags.some(applied => applied.id === tag.id))))

function setSelectionMode(enabled: boolean) {
  selectionMode.value = enabled
  selectedIds.value = new Set()
  bulkTagOpen.value = false
  bulkAssignOpen.value = false
}

function toggleConversationSelection(id: string) {
  if (cr.conversations.value.find(conversation => conversation.id === id)?.isSpam) {
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
  selectedIds.value = allPageSelected.value ? new Set() : new Set(selectablePageIds.value)
  if (pageConversationIds.value.length > MAX_BULK_CONVERSATIONS) {
    toast.add({
      title: `Selected the first ${MAX_BULK_CONVERSATIONS} conversations`,
      description: 'Finish this batch, then select the remaining conversations.',
      color: 'neutral'
    })
  }
}

watch(pageConversationIds, (ids) => {
  const visible = new Set(ids)
  selectedIds.value = new Set([...selectedIds.value].filter(id => visible.has(id)))
})
watch(searchActive, (active) => {
  if (active) setSelectionMode(false)
})
watch(() => cr.filter.value, (filter) => {
  if (filter === 'spam') setSelectionMode(false)
})

async function runBulkAction(input: BulkConversationInput, successLabel: string) {
  if (!selectedCount.value || bulkWorking.value) return
  bulkWorking.value = true
  try {
    const result = await cr.bulkUpdate(input)
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
    toast.add({
      title: getErrorMessage(error, 'Could not update the selected conversations'),
      description: 'Nothing was changed. Refresh the inbox and try again.',
      color: 'error'
    })
  } finally {
    bulkWorking.value = false
  }
}

function queueBulkAssign(memberId: string, memberName: string) {
  bulkAssignOpen.value = false
  pendingBulkAction.value = {
    input: { action: 'assign', conversation_ids: [...selectedIds.value], member_id: memberId },
    title: `Assign ${selectedCount.value} conversation${selectedCount.value === 1 ? '' : 's'} to ${memberName}?`,
    description: 'Resolved conversations will be reopened and snoozed conversations will return to the inbox.',
    confirmLabel: `Assign to ${memberName}`
  }
}

function queueBulkResolve() {
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
  if (!bulkWorking.value) pendingBulkAction.value = null
}

function applyBulkTag(tagId: string) {
  bulkTagOpen.value = false
  runBulkAction({ action: bulkTagMode.value, conversation_ids: [...selectedIds.value], tag_id: tagId }, bulkTagMode.value === 'add_tag' ? 'Tagged' : 'Updated')
}

function reopenSelected() {
  runBulkAction({ action: 'reopen', conversation_ids: [...selectedIds.value] }, 'Reopened')
}

function openSearchResult(id: string) {
  cr.select(id, { force: true })
}

const contextOpen = ref(false) // slideover on < xl
function openContext() {
  contextOpen.value = true
}

function tabCount(value: InboxFilter): number {
  const c = cr.counts.value
  return value === 'all' ? c.unassigned + c.open + c.resolved : c[value]
}

function initials(name: string | null, fallback = 'V') {
  return (name ?? fallback).trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || fallback
}

/* actions */
async function onClaim(id: string) {
  try {
    await cr.claim(id)
    toast.add({ title: 'Conversation claimed', icon: 'i-lucide-check', color: 'success' })
  } catch (e) {
    const owner = (e as { data?: { assignedAgentId?: string } })?.data?.assignedAgentId
    toast.add({
      title: 'Already claimed',
      description: owner ? `Taken by ${cr.memberName(owner) ?? 'another agent'}` : 'Another agent got there first',
      color: 'neutral'
    })
  }
}

function presenceDot(status: string) {
  return status === 'online' ? 'bg-green-500' : status === 'away' ? 'bg-amber-400' : 'bg-zinc-500'
}

// transfer menu — online agents first, current owner checked
const assignMenuItems = computed(() => {
  const active = cr.activeConversation.value
  const rank = (p: string) => (p === 'online' ? 0 : p === 'away' ? 1 : 2)
  const sorted = [...cr.members.value].sort((a, b) => rank(a.presence) - rank(b.presence))
  return [sorted.map(m => ({
    label: m.name,
    presence: m.presence,
    trailingIcon: active?.assignedAgentId === m.id ? 'i-lucide-check' : undefined,
    onSelect: () => onAssign(m.id, m.name)
  }))]
})

const canTransferActive = computed(() => {
  const active = cr.activeConversation.value
  return !!active?.assignedAgentId && (
    currentWorkspace.value?.role === 'admin'
    || active.assignedAgentId === currentWorkspace.value?.memberId
  )
})

async function onAssign(memberId: string, memberName: string) {
  const active = cr.activeConversation.value
  if (!active || active.assignedAgentId === memberId) return
  try {
    await cr.assign(active.id, memberId)
    toast.add({ title: `Transferred to ${memberName}`, icon: 'i-lucide-arrow-right-left', color: 'success' })
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not transfer'), color: 'error' })
  }
}

const spamConfirmOpen = ref(false)
const spamSaving = ref(false)

function openSpamConfirmation() {
  if (!cr.activeConversation.value) return
  spamConfirmOpen.value = true
}

async function confirmSpamAction() {
  const active = cr.activeConversation.value
  if (!active || spamSaving.value) return
  spamSaving.value = true
  try {
    if (active.isSpam) {
      const result = await cr.restoreSpam(active.id)
      toast.add({
        title: 'Conversation restored',
        description: result.visitor_blocked
          ? 'This visitor stays blocked because another conversation is still marked as spam.'
          : 'The visitor can send messages again.',
        color: 'success'
      })
    } else {
      await cr.markSpam(active.id)
      toast.add({
        title: 'Marked as spam',
        description: 'The visitor can no longer send messages to this workspace.',
        color: 'success'
      })
    }
    spamConfirmOpen.value = false
  } catch (error) {
    toast.add({ title: getErrorMessage(error, 'Could not update spam status'), color: 'error' })
  } finally {
    spamSaving.value = false
  }
}

const priorityMenuItems = computed(() => [priorities.map(priority => ({
  label: priority.label,
  icon: priority.icon,
  trailingIcon: cr.activeConversation.value?.priority === priority.value ? 'i-lucide-check' : undefined,
  onSelect: () => setPriority(priority.value)
}))])

async function setPriority(priority: ConversationPriority) {
  const active = cr.activeConversation.value
  if (!active || active.priority === priority) return
  try {
    await cr.organize(active.id, { priority })
    toast.add({ title: `Priority set to ${priority}`, color: 'success' })
  } catch (error) {
    toast.add({ title: getErrorMessage(error, 'Could not change priority'), color: 'error' })
  }
}

function nextLocalHour(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000)
}

function tomorrowMorning() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(9, 0, 0, 0)
  return date
}

async function setSnooze(date: Date | null) {
  const active = cr.activeConversation.value
  if (!active) return
  try {
    await cr.organize(active.id, { snoozed_until: date?.toISOString() ?? null })
    snoozeOpen.value = false
    toast.add({ title: date ? `Snoozed until ${date.toLocaleString()}` : 'Conversation returned to inbox', color: 'success' })
  } catch (error) {
    toast.add({ title: getErrorMessage(error, 'Could not update snooze'), color: 'error' })
  }
}

function applyCustomSnooze() {
  const date = new Date(customSnooze.value)
  if (Number.isNaN(date.getTime())) return
  setSnooze(date)
}

function snoozedLabel(value: string) {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// a mention toast (from the layout) asked us to open a specific conversation
const pendingSelect = useState<string | null>('inbox:pendingSelect', () => null)
onMounted(() => {
  const conversationId = route.query.conversation
  if (typeof conversationId === 'string') pendingSelect.value = conversationId
})
watch(pendingSelect, async (id) => {
  if (id) {
    // A notification is an explicit request to open one conversation. Clear
    // list filters first so a collaborator can see the selected row as well.
    cr.filter.value = 'all'
    cr.assigneeFilter.value = 'any'
    cr.priorityFilters.value = []
    cr.tagFilters.value = []
    cr.snoozedFilter.value = 'include'
    await cr.reload()
    await cr.select(id, { force: true })
    pendingSelect.value = null
    if (route.query.conversation === id) await navigateTo('/dashboard', { replace: true })
  }
}, { immediate: true })

/* conversation tagging */
const tagPickerOpen = ref(false)
const tagInput = ref('')
const addingTag = ref(false)

const tagSuggestions = computed(() => {
  const active = cr.activeConversation.value
  const applied = new Set((active?.tags ?? []).map(t => t.id))
  const q = tagInput.value.trim().toLowerCase()
  return cr.workspaceTags.value
    .filter(t => !applied.has(t.id) && (!q || t.name.includes(q)))
    .slice(0, 8)
})

async function addTagToActive(tag: { id: string, name: string }) {
  const active = cr.activeConversation.value
  if (!active) return
  try {
    await cr.applyTag(active.id, tag)
    tagInput.value = ''
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not tag'), color: 'error' })
  }
}

async function createAndApplyTag() {
  const name = tagInput.value.trim().toLowerCase()
  const active = cr.activeConversation.value
  if (!name || !active || addingTag.value) return
  addingTag.value = true
  try {
    const tag = await cr.createTag(name)
    await cr.applyTag(active.id, tag)
    tagInput.value = ''
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not create tag'), color: 'error' })
  } finally {
    addingTag.value = false
  }
}

// each status wears its own tint: amber = act, blue = in progress, green = done
const statusBadge = {
  unassigned: { color: 'warning' as const, icon: 'i-lucide-hand', label: 'Unassigned' },
  open: { color: 'info' as const, icon: 'i-lucide-message-circle', label: 'Open' },
  resolved: { color: 'success' as const, icon: 'i-lucide-check', label: 'Resolved' }
}
</script>

<template>
  <div class="flex h-full">
    <!-- inbox list (full-width on mobile; hidden once a chat is open) -->
    <div
      class="w-full md:w-80 lg:w-88 shrink-0 flex-col border-r border-default bg-default"
      :class="cr.activeId.value ? 'hidden md:flex' : 'flex'"
    >
      <div class="px-4 pt-4 pb-3 border-b border-default overflow-hidden">
        <div class="flex items-center justify-between gap-2">
          <h1 class="font-display text-lg font-bold text-highlighted">
            Inbox
          </h1>
          <div class="flex items-center gap-1.5">
            <UButton
              v-if="!searchActive && cr.filter.value !== 'spam'"
              :icon="selectionMode ? 'i-lucide-x' : 'i-lucide-list-checks'"
              color="neutral"
              :variant="selectionMode ? 'subtle' : 'ghost'"
              size="xs"
              :aria-label="selectionMode ? 'Cancel conversation selection' : 'Select conversations on this page'"
              @click="setSelectionMode(!selectionMode)"
            >
              <span class="hidden lg:inline">{{ selectionMode ? 'Cancel' : 'Select' }}</span>
            </UButton>
            <UPopover
              v-model:open="savedViewsOpen"
              :content="{ align: 'end' }"
            >
              <UButton
                icon="i-lucide-bookmark"
                color="neutral"
                variant="ghost"
                size="xs"
                square
                aria-label="Saved views"
              />
              <template #content>
                <div class="w-72 p-3">
                  <p class="text-sm font-semibold text-highlighted">
                    Saved views
                  </p>
                  <p
                    v-if="!cr.savedViews.value.length"
                    class="mt-2 text-xs text-muted"
                  >
                    Save your current filters for one-click access.
                  </p>
                  <ul
                    v-else
                    class="mt-2 space-y-1"
                  >
                    <li
                      v-for="view in cr.savedViews.value"
                      :key="view.id"
                      class="flex items-center gap-1"
                    >
                      <button
                        class="min-w-0 flex-1 truncate rounded-lg px-2.5 py-2 text-left text-sm text-muted hover:bg-elevated hover:text-highlighted"
                        @click="applySavedView(view)"
                      >
                        {{ view.name }}
                      </button>
                      <UButton
                        icon="i-lucide-trash-2"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        :aria-label="`Delete ${view.name}`"
                        @click="removeSavedView(view.id)"
                      />
                    </li>
                  </ul>
                  <form
                    class="mt-3 flex gap-2 border-t border-default pt-3"
                    @submit.prevent="saveView"
                  >
                    <UInput
                      v-model="newViewName"
                      class="min-w-0 flex-1"
                      size="sm"
                      maxlength="50"
                      placeholder="View name"
                    />
                    <UButton
                      type="submit"
                      size="sm"
                      :loading="savingView"
                      :disabled="!newViewName.trim()"
                    >
                      Save
                    </UButton>
                  </form>
                </div>
              </template>
            </UPopover>

            <UPopover
              v-model:open="filterOpen"
              :content="{ align: 'end' }"
            >
              <UButton
                icon="i-lucide-list-filter"
                color="neutral"
                :variant="activeAdvancedFilters ? 'subtle' : 'ghost'"
                size="xs"
                square
                :aria-label="activeAdvancedFilters ? `${activeAdvancedFilters} active inbox filters` : 'Filter inbox'"
              />
              <template #content>
                <div class="w-76 max-w-[90vw] p-3 space-y-4">
                  <div class="flex items-center justify-between">
                    <p class="text-sm font-semibold text-highlighted">
                      Filters
                    </p>
                    <button
                      v-if="activeAdvancedFilters"
                      class="text-xs text-primary-700 dark:text-primary-400 hover:underline"
                      @click="clearAdvancedFilters"
                    >
                      Clear all
                    </button>
                  </div>
                  <label class="block">
                    <span class="mb-1.5 block text-xs font-medium text-muted">Assignee</span>
                    <select
                      v-model="cr.assigneeFilter.value"
                      class="h-9 w-full rounded-lg border border-default bg-default px-2.5 text-sm text-highlighted outline-none focus:ring-2 focus:ring-primary-500/50"
                    >
                      <option
                        v-for="option in assigneeOptions"
                        :key="option.value"
                        :value="option.value"
                      >{{ option.label }}</option>
                    </select>
                  </label>
                  <fieldset>
                    <legend class="mb-1.5 text-xs font-medium text-muted">
                      Priority
                    </legend>
                    <div class="flex flex-wrap gap-1.5">
                      <button
                        v-for="priority in priorities"
                        :key="priority.value"
                        type="button"
                        class="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs ring-1 ring-default transition-colors"
                        :class="cr.priorityFilters.value.includes(priority.value) ? 'bg-primary-500/12 text-primary-700 dark:text-primary-400' : 'text-muted hover:bg-elevated'"
                        @click="togglePriorityFilter(priority.value)"
                      >
                        <UIcon
                          :name="priority.icon"
                          class="size-3.5"
                        />{{ priority.label }}
                      </button>
                    </div>
                  </fieldset>
                  <fieldset v-if="cr.workspaceTags.value.length">
                    <legend class="mb-1.5 text-xs font-medium text-muted">
                      Must include tags
                    </legend>
                    <div class="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                      <button
                        v-for="tag in cr.workspaceTags.value"
                        :key="tag.id"
                        type="button"
                        class="rounded-lg px-2 py-1 font-mono text-xs ring-1 ring-default transition-colors"
                        :class="cr.tagFilters.value.includes(tag.id) ? 'bg-primary-500/12 text-primary-700 dark:text-primary-400' : 'text-muted hover:bg-elevated'"
                        @click="toggleTagFilter(tag.id)"
                      >
                        #{{ tag.name }}
                      </button>
                    </div>
                  </fieldset>
                  <label class="block">
                    <span class="mb-1.5 block text-xs font-medium text-muted">Snoozed conversations</span>
                    <select
                      v-model="cr.snoozedFilter.value"
                      class="h-9 w-full rounded-lg border border-default bg-default px-2.5 text-sm text-highlighted outline-none focus:ring-2 focus:ring-primary-500/50"
                    >
                      <option value="exclude">Hide until they return</option>
                      <option value="include">Include in this inbox</option>
                      <option value="only">Show snoozed only</option>
                    </select>
                  </label>
                </div>
              </template>
            </UPopover>
            <UButton
              :icon="soundEnabled ? 'i-lucide-bell' : 'i-lucide-bell-off'"
              color="neutral"
              variant="ghost"
              size="xs"
              square
              :aria-label="soundEnabled ? 'Mute new-message sound' : 'Unmute new-message sound'"
              @click="toggleSound"
            />
          </div>
        </div>

        <div class="mt-3 flex items-center gap-1 overflow-x-auto scrollbar-none">
          <button
            v-for="f in filters"
            :key="f.value"
            class="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors"
            :class="cr.filter.value === f.value
              ? 'bg-primary-500/12 text-primary-700 dark:text-primary-400'
              : 'text-muted hover:text-highlighted'"
            @click="cr.filter.value = f.value"
          >
            {{ f.label }}
            <span
              class="rounded-full px-1.5 text-xs font-semibold tabular-nums"
              :class="f.value === 'unassigned' && tabCount('unassigned') > 0
                ? 'bg-primary-500 text-slate-950'
                : cr.filter.value === f.value ? 'bg-primary-500/15 text-primary-700 dark:text-primary-400' : 'bg-elevated text-dimmed'"
            >{{ tabCount(f.value) }}</span>
          </button>
          <button
            class="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors"
            :class="cr.responseFilter.value === 'breached'
              ? 'bg-red-500/12 text-red-700 dark:text-red-400'
              : 'text-muted hover:text-highlighted'"
            :aria-pressed="cr.responseFilter.value === 'breached'"
            @click="cr.responseFilter.value = cr.responseFilter.value === 'breached' ? 'all' : 'breached'"
          >
            Overdue
            <span
              class="rounded-full px-1.5 text-xs font-semibold tabular-nums"
              :class="cr.counts.value.breached > 0
                ? 'bg-red-500/15 text-red-700 dark:text-red-400'
                : 'bg-elevated text-dimmed'"
            >{{ cr.counts.value.breached }}</span>
          </button>
        </div>

        <!-- search: name, email, or anything anyone said -->
        <div class="mt-2.5 flex items-center gap-2 rounded-lg bg-elevated/60 ring-1 ring-default px-2.5 py-1.5 focus-within:ring-primary-500/60 transition-shadow">
          <UIcon
            :name="searching ? 'i-lucide-loader-circle' : 'i-lucide-search'"
            class="size-4 shrink-0 text-dimmed"
            :class="searching && 'animate-spin'"
          />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search conversations…"
            class="w-full bg-transparent text-sm outline-none placeholder:text-dimmed"
          >
          <button
            v-if="searchQuery"
            class="text-dimmed hover:text-highlighted"
            aria-label="Clear search"
            @click="searchQuery = ''"
          >
            <UIcon
              name="i-lucide-x"
              class="size-4"
            />
          </button>
        </div>

        <!-- active filter summary -->
        <div
          v-if="activeAdvancedFilters"
          class="mt-2 flex items-center gap-1 overflow-x-auto scrollbar-none"
        >
          <span class="rounded-md bg-elevated px-2 py-0.5 text-[11px] text-muted">{{ activeAdvancedFilters }} active</span>
          <button
            class="whitespace-nowrap text-[11px] text-primary-700 dark:text-primary-400 hover:underline"
            @click="filterOpen = true"
          >
            Edit filters
          </button>
          <button
            class="whitespace-nowrap text-[11px] text-dimmed hover:text-highlighted"
            @click="clearAdvancedFilters"
          >
            Clear
          </button>
        </div>
      </div>

      <div
        v-if="selectionMode"
        class="shrink-0 border-b border-default bg-elevated/35 px-3 py-2"
      >
        <div class="flex items-center gap-2">
          <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs font-medium text-highlighted">
            <input
              type="checkbox"
              class="size-4 shrink-0 rounded border-default accent-primary-500"
              :checked="allPageSelected"
              :indeterminate="somePageSelected"
              :aria-label="`Select up to ${MAX_BULK_CONVERSATIONS} conversations from the current page`"
              @change="toggleCurrentPage"
            >
            <span class="truncate">{{ selectedCount ? `${selectedCount} selected` : 'Select current page' }}</span>
          </label>
          <span class="shrink-0 text-[10px] text-dimmed">This page · max {{ MAX_BULK_CONVERSATIONS }}</span>
        </div>

        <div
          v-if="selectedCount"
          class="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none"
          role="toolbar"
          aria-label="Bulk conversation actions"
        >
          <UPopover
            v-model:open="bulkAssignOpen"
            :content="{ align: 'start' }"
          >
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              icon="i-lucide-user-round-check"
              :disabled="bulkWorking"
            >
              Assign
            </UButton>
            <template #content>
              <div class="w-64 max-w-[90vw] p-2">
                <p class="px-2 pb-1 text-xs font-medium text-muted">
                  Assign selected to
                </p>
                <ul class="max-h-56 overflow-y-auto">
                  <li
                    v-for="member in cr.members.value"
                    :key="member.id"
                  >
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-muted hover:bg-elevated hover:text-highlighted"
                      @click="queueBulkAssign(member.id, member.name)"
                    >
                      <span
                        class="size-2 rounded-full"
                        :class="presenceDot(member.presence)"
                      />
                      <span class="min-w-0 flex-1 truncate">{{ member.name }}</span>
                      <span class="text-[10px] capitalize text-dimmed">{{ member.presence }}</span>
                    </button>
                  </li>
                </ul>
                <p
                  v-if="currentWorkspace?.role === 'agent'"
                  class="border-t border-default px-2 pt-2 text-[11px] leading-4 text-dimmed"
                >
                  You can claim unassigned chats for yourself or transfer chats already assigned to you.
                </p>
              </div>
            </template>
          </UPopover>

          <UPopover
            v-model:open="bulkTagOpen"
            :content="{ align: 'start' }"
          >
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              icon="i-lucide-tags"
              :disabled="bulkWorking"
            >
              Tags
            </UButton>
            <template #content>
              <div class="w-60 max-w-[90vw] p-2">
                <div class="grid grid-cols-2 gap-1 rounded-lg bg-elevated p-1">
                  <button
                    type="button"
                    class="rounded-md px-2 py-1.5 text-xs font-medium"
                    :class="bulkTagMode === 'add_tag' ? 'bg-default text-highlighted shadow-sm' : 'text-muted'"
                    @click="bulkTagMode = 'add_tag'"
                  >
                    Add tag
                  </button>
                  <button
                    type="button"
                    class="rounded-md px-2 py-1.5 text-xs font-medium"
                    :class="bulkTagMode === 'remove_tag' ? 'bg-default text-highlighted shadow-sm' : 'text-muted'"
                    @click="bulkTagMode = 'remove_tag'"
                  >
                    Remove tag
                  </button>
                </div>
                <p
                  v-if="!bulkTagOptions.length"
                  class="px-2 py-4 text-center text-xs text-dimmed"
                >
                  {{ bulkTagMode === 'remove_tag' ? 'None of the selected conversations have a tag to remove.' : 'Create a tag from an open conversation first.' }}
                </p>
                <ul
                  v-else
                  class="mt-1 max-h-52 overflow-y-auto"
                >
                  <li
                    v-for="tag in bulkTagOptions"
                    :key="tag.id"
                  >
                    <button
                      type="button"
                      class="w-full rounded-lg px-2 py-2 text-left font-mono text-xs text-muted hover:bg-elevated hover:text-highlighted"
                      @click="applyBulkTag(tag.id)"
                    >
                      #{{ tag.name }}
                    </button>
                  </li>
                </ul>
              </div>
            </template>
          </UPopover>

          <UButton
            size="xs"
            color="neutral"
            variant="subtle"
            icon="i-lucide-rotate-ccw"
            :disabled="bulkWorking"
            @click="reopenSelected"
          >
            Reopen
          </UButton>
          <UButton
            size="xs"
            color="neutral"
            variant="subtle"
            icon="i-lucide-check-check"
            :disabled="bulkWorking"
            @click="queueBulkResolve"
          >
            Resolve
          </UButton>
        </div>
        <p
          v-else-if="!selectablePageIds.length"
          class="mt-2 text-[11px] leading-4 text-dimmed"
        >
          Spam conversations must be restored individually so visitor access is never changed by accident.
        </p>
      </div>

      <div class="flex-1 overflow-y-auto">
        <!-- search results -->
        <template v-if="searchActive">
          <p
            v-if="!searching && !searchResults.length"
            class="p-8 text-center text-sm text-dimmed"
          >
            Nothing matches “{{ searchQuery.trim() }}”.
          </p>
          <ul
            v-else
            class="divide-y divide-default/60"
          >
            <li
              v-for="r in searchResults"
              :key="r.id"
            >
              <button
                class="relative w-full flex gap-3 px-4 py-3 text-left transition-colors"
                :class="cr.activeId.value === r.id ? 'bg-primary-500/6' : 'hover:bg-elevated/50'"
                @click="openSearchResult(r.id)"
              >
                <span class="grid place-items-center size-9 shrink-0 rounded-xl avatar-primary text-xs font-bold">
                  {{ initials(r.visitor.name) }}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="truncate text-sm font-medium text-highlighted">{{ r.visitor.name ?? 'Visitor' }}</span>
                    <span class="ml-auto shrink-0 text-[11px] text-dimmed">{{ timeAgo(r.lastMessageAt) }}</span>
                  </div>
                  <p class="truncate text-xs mt-0.5 text-muted">
                    {{ r.snippet ?? r.visitor.email ?? '—' }}
                  </p>
                </div>
              </button>
            </li>
          </ul>
        </template>

        <template v-else>
          <div
            v-if="cr.loadingList.value"
            class="p-4 space-y-3"
          >
            <USkeleton
              v-for="n in 6"
              :key="n"
              class="h-14 w-full"
            />
          </div>

          <div
            v-else-if="!cr.conversations.value.length"
            class="p-8 text-center"
          >
            <div class="mx-auto grid place-items-center size-12 rounded-xl bg-primary-500/10 ring-1 ring-primary-500/25">
              <UIcon
                name="i-lucide-inbox"
                class="size-6 text-primary-600 dark:text-primary-400"
              />
            </div>
            <p class="mt-3 text-sm font-medium text-highlighted">
              No conversations yet
            </p>
            <p class="mt-1 text-xs text-muted">
              New chats from your widget will appear here in real time.
            </p>
          </div>

          <ul
            v-else
            class="divide-y divide-default/60"
          >
            <li
              v-for="c in cr.conversations.value"
              :key="c.id"
              class="group relative flex items-stretch"
              :class="selectedIds.has(c.id) && 'bg-primary-500/6'"
            >
              <label
                v-if="selectionMode"
                class="flex shrink-0 items-start py-4 pl-3"
                :class="c.isSpam ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'"
                :aria-label="c.isSpam ? 'Spam conversations must be restored individually' : `Select conversation with ${c.visitor.name ?? 'Visitor'}`"
              >
                <input
                  type="checkbox"
                  class="size-4 rounded border-default accent-primary-500"
                  :checked="selectedIds.has(c.id)"
                  :disabled="c.isSpam"
                  @change="toggleConversationSelection(c.id)"
                >
              </label>
              <button
                class="relative min-w-0 flex-1 flex gap-3 px-4 py-3 text-left transition-colors"
                :class="cr.activeId.value === c.id || selectedIds.has(c.id) ? 'bg-primary-500/6' : 'hover:bg-elevated/50'"
                @click="selectionMode && !c.isSpam ? toggleConversationSelection(c.id) : cr.select(c.id)"
              >
                <span
                  v-if="cr.activeId.value === c.id"
                  class="absolute inset-y-0 left-0 w-0.5 bg-primary-500"
                />
                <span class="grid place-items-center size-9 shrink-0 rounded-xl avatar-primary text-xs font-bold">
                  {{ initials(c.visitor.name) }}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span
                      class="truncate text-sm text-highlighted"
                      :class="c.unread ? 'font-semibold' : 'font-medium'"
                    >{{ c.visitor.name ?? 'Visitor' }}</span>
                    <span class="ml-auto shrink-0 text-[11px] text-dimmed">{{ timeAgo(c.lastMessageAt) }}</span>
                  </div>
                  <p
                    class="truncate text-xs mt-0.5"
                    :class="c.unread ? 'text-highlighted font-medium' : 'text-muted'"
                  >
                    {{ c.preview || '—' }}
                  </p>
                  <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span
                      v-if="c.priority !== 'normal'"
                      class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold capitalize"
                      :class="c.priority === 'urgent' ? 'bg-red-500/12 text-red-600 dark:text-red-400' : c.priority === 'high' ? 'bg-orange-500/12 text-orange-700 dark:text-orange-400' : 'bg-elevated text-muted'"
                    >
                      <UIcon
                        :name="priorities.find(priority => priority.value === c.priority)?.icon"
                        class="size-3"
                      />
                      {{ c.priority }}
                    </span>
                    <UBadge
                      v-if="c.isSpam"
                      color="error"
                      variant="subtle"
                      icon="i-lucide-shield-ban"
                      size="sm"
                    >
                      Spam
                    </UBadge>
                    <UBadge
                      v-else
                      :color="statusBadge[c.status].color"
                      variant="subtle"
                      :icon="statusBadge[c.status].icon"
                      size="sm"
                    >
                      {{ statusBadge[c.status].label }}
                    </UBadge>
                    <ResponseSlaBadge
                      :sla="c.responseSla"
                      :now="slaNow"
                    />
                    <span
                      v-if="c.assignedAgentId"
                      class="ml-auto flex items-center gap-1.5 shrink-0 rounded-full bg-elevated/70 ring-1 ring-default pl-2 pr-2.5 py-0.5"
                      :title="cr.memberName(c.assignedAgentId) ?? ''"
                    >
                      <span
                        class="size-1.5 rounded-full"
                        :class="presenceDot(cr.memberPresence(c.assignedAgentId))"
                      />
                      <span class="text-[10px] font-medium text-muted truncate max-w-20">{{ (cr.memberName(c.assignedAgentId) ?? 'Agent').split(' ')[0] }}</span>
                    </span>
                    <span
                      v-if="c.snoozedUntil && cr.snoozedFilter.value !== 'exclude'"
                      class="ml-auto inline-flex items-center gap-1 text-[10px] text-muted"
                      :title="`Snoozed until ${snoozedLabel(c.snoozedUntil)}`"
                    >
                      <UIcon
                        name="i-lucide-clock-3"
                        class="size-3"
                      />
                      {{ snoozedLabel(c.snoozedUntil) }}
                    </span>
                  </div>
                </div>
                <span
                  v-if="c.unread"
                  class="mt-1.5 size-2 shrink-0 rounded-full bg-primary-500"
                />
              </button>
              <!-- quick claim straight from the list -->
              <UButton
                v-if="c.status === 'unassigned' && !selectionMode"
                class="absolute right-3 bottom-2.5"
                size="xs"
                color="primary"
                icon="i-lucide-hand"
                label="Claim"
                @click.stop="onClaim(c.id)"
              />
            </li>
          </ul>

          <div
            v-if="!cr.loadingList.value && cr.hasMoreConversations.value"
            class="p-3"
          >
            <UButton
              block
              size="sm"
              color="neutral"
              variant="subtle"
              icon="i-lucide-chevrons-down"
              :loading="cr.loadingMore.value"
              @click="cr.loadMoreConversations()"
            >
              Load more conversations
            </UButton>
          </div>
        </template>
      </div>
    </div>

    <!-- conversation pane (full-screen on mobile when a chat is open) -->
    <div
      class="flex-1 flex-col min-w-0 bg-elevated/10"
      :class="cr.activeId.value ? 'flex' : 'hidden md:flex'"
    >
      <div
        v-if="!cr.activeConversation.value"
        class="flex-1 grid place-items-center p-8"
      >
        <div class="text-center">
          <div class="mx-auto grid place-items-center size-14 rounded-2xl bg-elevated ring-1 ring-default">
            <UIcon
              name="i-lucide-messages-square"
              class="size-7 text-dimmed"
            />
          </div>
          <p class="mt-4 text-sm text-muted">
            Select a conversation to view the thread.
          </p>
          <p class="mt-1 text-xs text-dimmed">
            Tip: type <span class="font-mono text-highlighted">/</span> in the composer to insert a canned reply.
          </p>
        </div>
      </div>

      <template v-else>
        <!-- header -->
        <div class="h-16 shrink-0 flex items-center gap-2 sm:gap-3 px-3 sm:px-5 border-b border-default bg-default">
          <UButton
            class="md:hidden -ml-1"
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            aria-label="Back to inbox"
            @click="cr.deselect()"
          />
          <span class="hidden sm:grid place-items-center size-9 shrink-0 rounded-xl avatar-primary text-sm font-bold">
            {{ initials(cr.activeConversation.value.visitor.name) }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-highlighted leading-tight truncate">
              {{ cr.activeConversation.value.visitor.name ?? 'Visitor' }}
            </p>
            <p class="text-[11px] text-dimmed truncate">
              {{ cr.activeConversation.value.visitor.email ?? cr.activeConversation.value.visitor.visitorId }}
            </p>
          </div>

          <ResponseSlaBadge
            :sla="cr.activeConversation.value.responseSla"
            :now="slaNow"
          />

          <UBadge
            v-if="cr.activeConversation.value.isSpam"
            class="hidden sm:inline-flex"
            color="error"
            variant="subtle"
            icon="i-lucide-shield-ban"
          >
            Spam
          </UBadge>

          <div class="flex items-center gap-1 sm:gap-2 shrink-0">
            <UDropdownMenu
              :items="priorityMenuItems"
              :content="{ align: 'end' }"
            >
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                :icon="priorities.find(priority => priority.value === cr.activeConversation.value?.priority)?.icon"
                :aria-label="`Priority: ${cr.activeConversation.value.priority}`"
              >
                <span class="hidden lg:inline capitalize">{{ cr.activeConversation.value.priority }}</span>
              </UButton>
            </UDropdownMenu>

            <UPopover
              v-model:open="snoozeOpen"
              :content="{ align: 'end' }"
            >
              <UButton
                size="sm"
                color="neutral"
                :variant="cr.activeConversation.value.snoozedUntil ? 'subtle' : 'ghost'"
                icon="i-lucide-clock-3"
                :aria-label="cr.activeConversation.value.snoozedUntil ? `Snoozed until ${snoozedLabel(cr.activeConversation.value.snoozedUntil)}` : 'Snooze conversation'"
              >
                <span class="hidden lg:inline">Snooze</span>
              </UButton>
              <template #content>
                <div class="w-72 p-3">
                  <p class="text-sm font-semibold text-highlighted">
                    Snooze conversation
                  </p>
                  <div class="mt-2 grid grid-cols-2 gap-1.5">
                    <UButton
                      color="neutral"
                      variant="subtle"
                      size="sm"
                      @click="setSnooze(nextLocalHour(1))"
                    >
                      In 1 hour
                    </UButton>
                    <UButton
                      color="neutral"
                      variant="subtle"
                      size="sm"
                      @click="setSnooze(nextLocalHour(4))"
                    >
                      In 4 hours
                    </UButton>
                    <UButton
                      color="neutral"
                      variant="subtle"
                      size="sm"
                      @click="setSnooze(tomorrowMorning())"
                    >
                      Tomorrow, 9:00
                    </UButton>
                    <UButton
                      color="neutral"
                      variant="subtle"
                      size="sm"
                      @click="setSnooze(nextLocalHour(24 * 7))"
                    >
                      In 1 week
                    </UButton>
                  </div>
                  <form
                    class="mt-3 border-t border-default pt-3"
                    @submit.prevent="applyCustomSnooze"
                  >
                    <label
                      class="block text-xs font-medium text-muted"
                      for="custom-snooze"
                    >Choose a date and time</label>
                    <div class="mt-1.5 flex gap-2">
                      <input
                        id="custom-snooze"
                        v-model="customSnooze"
                        required
                        type="datetime-local"
                        class="h-9 min-w-0 flex-1 rounded-lg border border-default bg-default px-2 text-xs text-highlighted outline-none focus:ring-2 focus:ring-primary-500/50"
                      >
                      <UButton
                        type="submit"
                        size="sm"
                      >
                        Set
                      </UButton>
                    </div>
                  </form>
                  <UButton
                    v-if="cr.activeConversation.value.snoozedUntil"
                    class="mt-2"
                    block
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    @click="setSnooze(null)"
                  >
                    Return to inbox now
                  </UButton>
                </div>
              </template>
            </UPopover>

            <!-- assignee / transfer -->
            <UDropdownMenu
              v-if="canTransferActive"
              :items="assignMenuItems"
              :content="{ align: 'end' }"
            >
              <UButton
                size="sm"
                color="neutral"
                :variant="cr.activeConversation.value.assignedAgentId ? 'subtle' : 'ghost'"
                trailing-icon="i-lucide-chevron-down"
              >
                <span
                  v-if="cr.activeConversation.value.assignedAgentId"
                  class="flex items-center gap-1.5"
                >
                  <span
                    class="size-1.5 rounded-full"
                    :class="presenceDot(cr.memberPresence(cr.activeConversation.value.assignedAgentId))"
                  />
                  <span class="hidden sm:inline truncate max-w-28">{{ cr.memberName(cr.activeConversation.value.assignedAgentId) }}</span>
                </span>
                <span
                  v-else
                  class="text-muted"
                >
                  <span class="hidden sm:inline">Assign</span>
                  <UIcon
                    name="i-lucide-user-round-plus"
                    class="size-4 sm:hidden"
                  />
                </span>
              </UButton>

              <template #item-label="{ item }">
                <span class="flex items-center gap-2">
                  <span
                    class="size-1.5 rounded-full"
                    :class="presenceDot((item as { presence: string }).presence)"
                  />
                  {{ item.label }}
                </span>
              </template>
            </UDropdownMenu>

            <UButton
              v-if="cr.activeConversation.value.status === 'unassigned'"
              size="sm"
              color="primary"
              icon="i-lucide-hand"
              class="font-medium"
              @click="onClaim(cr.activeConversation.value.id)"
            >
              <span class="hidden sm:inline">Claim</span>
            </UButton>

            <UButton
              v-if="cr.activeConversation.value.status === 'resolved' && !cr.activeConversation.value.isSpam"
              size="sm"
              color="neutral"
              variant="subtle"
              icon="i-lucide-rotate-ccw"
              @click="cr.reopen(cr.activeConversation.value.id)"
            >
              <span class="hidden sm:inline">Reopen</span>
            </UButton>
            <UButton
              v-else-if="!cr.activeConversation.value.isSpam"
              size="sm"
              color="neutral"
              variant="subtle"
              icon="i-lucide-check-check"
              @click="cr.resolve(cr.activeConversation.value.id)"
            >
              <span class="hidden sm:inline">Resolve</span>
            </UButton>

            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              :icon="cr.activeConversation.value.isSpam ? 'i-lucide-rotate-ccw' : 'i-lucide-shield-ban'"
              :aria-label="cr.activeConversation.value.isSpam ? 'Restore spam conversation' : 'Mark conversation as spam'"
              :title="cr.activeConversation.value.isSpam ? 'Restore spam conversation' : 'Mark conversation as spam'"
              @click="openSpamConfirmation"
            />

            <!-- visitor context (slideover below xl; static panel on xl+) -->
            <UButton
              class="xl:hidden"
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-panel-right"
              aria-label="Visitor details"
              @click="openContext"
            />
          </div>
        </div>

        <!-- tags -->
        <div class="shrink-0 flex items-center gap-1.5 flex-wrap px-3 sm:px-5 py-1.5 border-b border-default bg-default">
          <span
            v-for="t in cr.activeConversation.value.tags"
            :key="t.id"
            class="group/tag inline-flex items-center gap-1 rounded-md bg-primary-500/10 ring-1 ring-primary-500/25 pl-1.5 pr-1 py-0.5 font-mono text-[11px] text-primary-700 dark:text-primary-400"
          >
            #{{ t.name }}
            <button
              class="opacity-40 group-hover/tag:opacity-100 hover:text-red-500 transition-opacity"
              :aria-label="`Remove ${t.name}`"
              @click="cr.removeTag(cr.activeConversation.value!.id, t.id)"
            >
              <UIcon
                name="i-lucide-x"
                class="size-3"
              />
            </button>
          </span>

          <UPopover
            v-model:open="tagPickerOpen"
            :content="{ align: 'start' }"
          >
            <button class="inline-flex items-center gap-1 rounded-md ring-1 ring-default px-1.5 py-0.5 text-[11px] text-dimmed hover:text-highlighted hover:bg-elevated transition-colors">
              <UIcon
                name="i-lucide-tag"
                class="size-3"
              />
              {{ cr.activeConversation.value.tags.length ? 'Tag' : 'Add tag' }}
            </button>
            <template #content>
              <div class="w-56 p-2">
                <UInput
                  v-model="tagInput"
                  size="sm"
                  placeholder="Find or create a tag…"
                  autofocus
                  @keyup.enter="tagSuggestions.length ? addTagToActive(tagSuggestions[0]!) : createAndApplyTag()"
                />
                <ul
                  v-if="tagSuggestions.length"
                  class="mt-1.5 space-y-0.5"
                >
                  <li
                    v-for="t in tagSuggestions"
                    :key="t.id"
                  >
                    <button
                      class="w-full rounded-md px-2 py-1 text-left font-mono text-xs text-muted hover:bg-elevated hover:text-highlighted transition-colors"
                      @click="addTagToActive(t)"
                    >
                      #{{ t.name }}
                    </button>
                  </li>
                </ul>
                <button
                  v-if="tagInput.trim() && !cr.workspaceTags.value.some(t => t.name === tagInput.trim().toLowerCase())"
                  class="mt-1.5 w-full rounded-md px-2 py-1 text-left text-xs text-primary-700 dark:text-primary-400 hover:bg-primary-500/10 transition-colors"
                  :disabled="addingTag"
                  @click="createAndApplyTag"
                >
                  + Create “#{{ tagInput.trim().toLowerCase() }}”
                </button>
              </div>
            </template>
          </UPopover>
        </div>

        <div class="flex-1 flex min-h-0">
          <div class="flex-1 flex flex-col min-w-0">
            <ConversationThread
              :messages="cr.messages.value"
              :loading="cr.loadingThread.value"
              :has-more="cr.hasMoreMessages.value"
              :loading-older="cr.loadingOlder.value"
              :visitor-typing="cr.visitorTyping.value"
              :visitor-draft="cr.visitorDraft.value"
              :member-name="cr.memberName"
              :load-older-messages="cr.loadOlderMessages"
              :retry-send="cr.retrySend"
            />

            <ConversationComposer
              :key="cr.activeConversation.value.id"
              :workspace-id="currentWorkspace?.workspaceId ?? null"
              :members="cr.members.value"
              :current-member-id="currentWorkspace?.memberId ?? null"
              :canned-responses="cr.canned.value"
              :send-reply="cr.sendReply"
              :send-attachment="cr.sendAttachment"
              :attachments-available="currentWorkspace?.attachmentsAvailable ?? false"
              :public-reply-disabled="cr.activeConversation.value.isSpam"
            />
          </div>

          <!-- visitor context panel (xl+) -->
          <aside class="hidden xl:block w-72 shrink-0 border-l border-default bg-default">
            <VisitorContextPanel
              :context="cr.context.value"
              :fallback-name="cr.activeConversation.value.visitor.name"
              :available-tags="cr.workspaceTags.value"
              :save-profile="cr.updateCustomerProfile"
            />
          </aside>
        </div>

        <!-- visitor context slideover (< xl) -->
        <USlideover
          v-model:open="contextOpen"
          side="right"
          title="Visitor details"
          :ui="{ content: 'w-80 max-w-[90vw]' }"
        >
          <template #content>
            <VisitorContextPanel
              :context="cr.context.value"
              :fallback-name="cr.activeConversation.value?.visitor.name ?? null"
              :available-tags="cr.workspaceTags.value"
              :save-profile="cr.updateCustomerProfile"
            />
          </template>
        </USlideover>
      </template>
    </div>

    <UModal
      :open="!!pendingBulkAction"
      :title="pendingBulkAction?.title"
      :description="pendingBulkAction?.description"
      @update:open="(open: boolean) => { if (!open && !bulkWorking) pendingBulkAction = null }"
    >
      <template #footer>
        <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="bulkWorking"
            @click="pendingBulkAction = null"
          >
            Cancel
          </UButton>
          <UButton
            color="primary"
            :loading="bulkWorking"
            icon="i-lucide-check-check"
            @click="confirmBulkAction"
          >
            {{ pendingBulkAction?.confirmLabel }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="spamConfirmOpen"
      :title="cr.activeConversation.value?.isSpam ? 'Restore this conversation?' : 'Mark as spam and block visitor?'"
      :description="cr.activeConversation.value?.isSpam
        ? 'The conversation returns to the regular inbox. The visitor is unblocked unless another conversation from them is still marked as spam.'
        : 'The conversation moves to Spam and closes. This visitor will not be able to send new messages to this workspace.'"
    >
      <template #body>
        <div class="rounded-xl bg-elevated/60 p-3 text-sm text-muted ring-1 ring-default">
          <p v-if="cr.activeConversation.value?.isSpam">
            Existing messages stay in the conversation history. Restoring does not reopen the conversation until the visitor sends another message.
          </p>
          <p v-else>
            This does not delete any history. Anonymous visitors are blocked for this browser session; verified signed-in identities stay blocked across new sessions.
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <UButton
            color="neutral"
            variant="ghost"
            class="justify-center"
            @click="spamConfirmOpen = false"
          >
            Cancel
          </UButton>
          <UButton
            :color="cr.activeConversation.value?.isSpam ? 'primary' : 'error'"
            :icon="cr.activeConversation.value?.isSpam ? 'i-lucide-rotate-ccw' : 'i-lucide-shield-ban'"
            :loading="spamSaving"
            class="justify-center"
            @click="confirmSpamAction"
          >
            {{ cr.activeConversation.value?.isSpam ? 'Restore and unblock' : 'Mark as spam' }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
