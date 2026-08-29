<script setup lang="ts">
import type { InboxFilter } from '~/composables/useControlRoom'

definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Inbox · Perch' })

const toast = useToast()
const cr = useControlRoom()
const { currentWorkspace } = useAuth()
const { enabled: soundEnabled, toggle: toggleSound } = useNotificationSound()

const filters: { label: string, value: InboxFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Unassigned', value: 'unassigned' },
  { label: 'Open', value: 'open' },
  { label: 'Resolved', value: 'resolved' }
]

/* inbox search (visitor name/email or message text) */
const {
  query: searchQuery,
  results: searchResults,
  searching,
  active: searchActive
} = useConversationSearch(() => currentWorkspace.value?.workspaceId)

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

// a mention toast (from the layout) asked us to open a specific conversation
const pendingSelect = useState<string | null>('inbox:pendingSelect', () => null)
watch(pendingSelect, (id) => {
  if (id) {
    cr.select(id, { force: true })
    pendingSelect.value = null
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
              ? 'bg-amber-500/12 text-amber-700 dark:text-amber-400'
              : 'text-muted hover:text-highlighted'"
            @click="cr.filter.value = f.value"
          >
            {{ f.label }}
            <span
              class="rounded-full px-1.5 text-xs font-semibold tabular-nums"
              :class="f.value === 'unassigned' && tabCount('unassigned') > 0
                ? 'bg-amber-500 text-slate-950'
                : cr.filter.value === f.value ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'bg-elevated text-dimmed'"
            >{{ tabCount(f.value) }}</span>
          </button>
        </div>

        <!-- search: name, email, or anything anyone said -->
        <div class="mt-2.5 flex items-center gap-2 rounded-lg bg-elevated/60 ring-1 ring-default px-2.5 py-1.5 focus-within:ring-amber-500/60 transition-shadow">
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

        <!-- tag filter -->
        <div
          v-if="cr.workspaceTags.value.length"
          class="mt-2 flex items-center gap-1 overflow-x-auto scrollbar-none"
        >
          <button
            class="rounded-lg px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors"
            :class="!cr.tagFilter.value ? 'bg-elevated text-highlighted' : 'text-dimmed hover:text-muted'"
            @click="cr.tagFilter.value = null"
          >
            All tags
          </button>
          <button
            v-for="t in cr.workspaceTags.value"
            :key="t.id"
            class="rounded-lg px-2 py-0.5 font-mono text-[11px] whitespace-nowrap transition-colors"
            :class="cr.tagFilter.value === t.id
              ? 'bg-amber-500/12 text-amber-700 dark:text-amber-400'
              : 'text-dimmed hover:text-muted'"
            @click="cr.tagFilter.value = cr.tagFilter.value === t.id ? null : t.id"
          >
            #{{ t.name }}
          </button>
        </div>
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
                :class="cr.activeId.value === r.id ? 'bg-amber-500/6' : 'hover:bg-elevated/50'"
                @click="openSearchResult(r.id)"
              >
                <span class="grid place-items-center size-9 shrink-0 rounded-xl avatar-amber text-xs font-bold">
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
            <div class="mx-auto grid place-items-center size-12 rounded-xl bg-amber-500/10 ring-1 ring-amber-500/25">
              <UIcon
                name="i-lucide-inbox"
                class="size-6 text-amber-600 dark:text-amber-400"
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
              class="group relative"
            >
              <button
                class="relative w-full flex gap-3 px-4 py-3 text-left transition-colors"
                :class="cr.activeId.value === c.id ? 'bg-amber-500/6' : 'hover:bg-elevated/50'"
                @click="cr.select(c.id)"
              >
                <span
                  v-if="cr.activeId.value === c.id"
                  class="absolute inset-y-0 left-0 w-0.5 bg-amber-500"
                />
                <span class="grid place-items-center size-9 shrink-0 rounded-xl avatar-amber text-xs font-bold">
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
                  <div class="mt-1.5 flex items-center gap-1.5">
                    <UBadge
                      :color="statusBadge[c.status].color"
                      variant="subtle"
                      :icon="statusBadge[c.status].icon"
                      size="sm"
                    >
                      {{ statusBadge[c.status].label }}
                    </UBadge>
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
                  </div>
                </div>
                <span
                  v-if="c.unread"
                  class="mt-1.5 size-2 shrink-0 rounded-full bg-amber-500"
                />
              </button>
              <!-- quick claim straight from the list -->
              <UButton
                v-if="c.status === 'unassigned'"
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
          <span class="hidden sm:grid place-items-center size-9 shrink-0 rounded-xl avatar-amber text-sm font-bold">
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

          <div class="flex items-center gap-1 sm:gap-2 shrink-0">
            <!-- assignee / transfer -->
            <UDropdownMenu
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
              v-if="cr.activeConversation.value.status === 'resolved'"
              size="sm"
              color="neutral"
              variant="subtle"
              icon="i-lucide-rotate-ccw"
              @click="cr.reopen(cr.activeConversation.value.id)"
            >
              <span class="hidden sm:inline">Reopen</span>
            </UButton>
            <UButton
              v-else
              size="sm"
              color="neutral"
              variant="subtle"
              icon="i-lucide-check-check"
              @click="cr.resolve(cr.activeConversation.value.id)"
            >
              <span class="hidden sm:inline">Resolve</span>
            </UButton>

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
            class="group/tag inline-flex items-center gap-1 rounded-md bg-amber-500/10 ring-1 ring-amber-500/25 pl-1.5 pr-1 py-0.5 font-mono text-[11px] text-amber-700 dark:text-amber-400"
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
                  class="mt-1.5 w-full rounded-md px-2 py-1 text-left text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
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
              :members="cr.members.value"
              :canned-responses="cr.canned.value"
              :send-reply="cr.sendReply"
              :send-attachment="cr.sendAttachment"
            />
          </div>

          <!-- visitor context panel (xl+) -->
          <aside class="hidden xl:block w-72 shrink-0 border-l border-default bg-default">
            <VisitorContextPanel
              :context="cr.context.value"
              :fallback-name="cr.activeConversation.value.visitor.name"
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
            />
          </template>
        </USlideover>
      </template>
    </div>
  </div>
</template>
