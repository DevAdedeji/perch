<script setup lang="ts">
import type { InboxFilter } from '~/composables/useControlRoom'

definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Inbox · Perch' })

const toast = useToast()
const cr = useControlRoom()
const { enabled: soundEnabled, toggle: toggleSound } = useNotificationSound()

const filters: { label: string, value: InboxFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Unassigned', value: 'unassigned' },
  { label: 'Open', value: 'open' },
  { label: 'Resolved', value: 'resolved' }
]

const reply = ref('')
const internalNote = ref(false)
const sending = ref(false)

function tabCount(value: InboxFilter): number {
  const c = cr.counts.value
  return value === 'all' ? c.unassigned + c.open + c.resolved : c[value]
}

// keep the thread pinned to the newest message
const threadEl = ref<HTMLElement | null>(null)
watch(() => cr.messages.value.length, () => {
  nextTick(() => {
    if (threadEl.value) threadEl.value.scrollTop = threadEl.value.scrollHeight
  })
})

function initials(name: string | null, fallback = 'V') {
  return (name ?? fallback).trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || fallback
}

async function onSend() {
  const text = reply.value.trim()
  if (!text || sending.value) return
  sending.value = true
  try {
    await cr.sendReply(text, internalNote.value)
    reply.value = ''
    internalNote.value = false
  } catch {
    toast.add({ title: 'Could not send message', color: 'error' })
  } finally {
    sending.value = false
  }
}

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
  return status === 'online' ? 'bg-green-500' : status === 'away' ? 'bg-amber-400' : 'bg-red-500'
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
</script>

<template>
  <div class="flex h-full">
    <!-- ── inbox list (full-width on mobile; hidden once a chat is open) ── -->
    <div
      class="w-full md:w-80 lg:w-96 shrink-0 flex-col border-r border-default bg-default"
      :class="cr.activeId.value ? 'hidden md:flex' : 'flex'"
    >
      <div class="px-4 pt-4 pb-3 border-b border-default overflow-hidden">
        <div class="flex items-center justify-between gap-2">
          <h1 class="font-display text-lg font-bold text-highlighted">
            Inbox
          </h1>
          <div class="flex items-center gap-1.5">
            <span
              class="flex items-center gap-1.5 text-[11px]"
              :class="cr.status.value === 'open' ? 'text-green-600 dark:text-green-500' : 'text-dimmed'"
            >
              <span
                class="size-1.5 rounded-full"
                :class="cr.status.value === 'open' ? 'bg-green-500 animate-pulse' : 'bg-zinc-400'"
              />
              {{ cr.status.value === 'open' ? 'live' : 'connecting…' }}
            </span>
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

        <div class="mt-3 flex items-center gap-1 overflow-x-scroll">
          <button
            v-for="f in filters"
            :key="f.value"
            class="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium transition-colors"
            :class="cr.filter.value === f.value ? 'bg-inverted/10 text-highlighted' : 'text-muted hover:text-highlighted'"
            @click="cr.filter.value = f.value"
          >
            {{ f.label }}
            <span
              class="rounded-full px-1.5 text-xs font-semibold tabular-nums"
              :class="f.value === 'unassigned' && tabCount('unassigned') > 0
                ? 'bg-inverted text-inverted'
                : cr.filter.value === f.value ? 'bg-inverted/15 text-highlighted' : 'bg-elevated text-dimmed'"
            >{{ tabCount(f.value) }}</span>
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto">
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
          <div class="mx-auto grid place-items-center size-12 rounded-xl bg-inverted/15 ring-1 ring-inverted/25">
            <UIcon
              name="i-lucide-inbox"
              class="size-6 text-highlighted"
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
          >
            <button
              class="relative w-full flex gap-3 px-4 py-3 text-left transition-colors"
              :class="cr.activeId.value === c.id ? 'bg-inverted/6' : 'hover:bg-elevated/50'"
              @click="cr.select(c.id)"
            >
              <span
                v-if="cr.activeId.value === c.id"
                class="absolute inset-y-0 left-0 w-0.5 bg-inverted"
              />
              <span class="grid place-items-center size-9 shrink-0 rounded-lg bg-elevated ring-1 ring-default text-xs font-semibold text-muted">
                {{ initials(c.visitor.name) }}
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="truncate text-sm font-medium text-highlighted">{{ c.visitor.name ?? 'Visitor' }}</span>
                  <span class="ml-auto shrink-0 text-[11px] text-dimmed">{{ timeAgo(c.lastMessageAt) }}</span>
                </div>
                <p class="truncate text-xs text-muted mt-0.5">
                  {{ c.preview || '—' }}
                </p>
                <div class="mt-1.5 flex items-center gap-1.5">
                  <UBadge
                    :color="c.status === 'unassigned' ? 'warning' : c.status === 'open' ? 'info' : 'success'"
                    variant="subtle"
                    size="sm"
                    class="capitalize"
                  >
                    {{ c.status }}
                  </UBadge>
                  <span
                    v-if="c.assignedAgentId"
                    class="text-[10px] text-dimmed"
                  >· {{ cr.memberName(c.assignedAgentId) }}</span>
                </div>
              </div>
              <span
                v-if="c.unread"
                class="mt-1.5 size-2 shrink-0 rounded-full bg-inverted"
              />
            </button>
          </li>
        </ul>
      </div>
    </div>

    <!-- ── conversation pane (full-screen on mobile when a chat is open) ── -->
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
        </div>
      </div>

      <template v-else>
        <!-- header -->
        <div class="h-16 shrink-0 flex items-center gap-3 px-4 sm:px-5 border-b border-default bg-default">
          <UButton
            class="md:hidden -ml-1"
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            aria-label="Back to inbox"
            @click="cr.deselect()"
          />
          <span class="grid place-items-center size-9 rounded-lg bg-elevated ring-1 ring-default text-sm font-semibold text-muted">
            {{ initials(cr.activeConversation.value.visitor.name) }}
          </span>
          <div class="min-w-0">
            <p class="text-sm font-semibold text-highlighted leading-tight truncate">
              {{ cr.activeConversation.value.visitor.name ?? 'Visitor' }}
            </p>
            <p class="text-[11px] text-dimmed truncate">
              {{ cr.activeConversation.value.visitor.email ?? cr.activeConversation.value.visitor.visitorId }}
            </p>
          </div>

          <div class="ml-auto flex items-center gap-2">
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
                  {{ cr.memberName(cr.activeConversation.value.assignedAgentId) }}
                </span>
                <span
                  v-else
                  class="text-muted"
                >Assign</span>
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
              color="neutral"
              icon="i-lucide-hand"
              @click="onClaim(cr.activeConversation.value.id)"
            >
              Claim
            </UButton>

            <UButton
              v-if="cr.activeConversation.value.status === 'resolved'"
              size="sm"
              color="neutral"
              variant="subtle"
              icon="i-lucide-rotate-ccw"
              @click="cr.reopen(cr.activeConversation.value.id)"
            >
              Reopen
            </UButton>
            <UButton
              v-else
              size="sm"
              color="neutral"
              variant="subtle"
              icon="i-lucide-check-check"
              @click="cr.resolve(cr.activeConversation.value.id)"
            >
              Resolve
            </UButton>
          </div>
        </div>

        <!-- thread loading -->
        <div
          v-if="cr.loadingThread.value"
          class="flex-1 px-5 py-5 space-y-3 bg-grid"
        >
          <USkeleton class="h-9 w-44 rounded-2xl rounded-bl-md" />
          <USkeleton class="h-9 w-56 rounded-2xl rounded-br-md ml-auto" />
          <USkeleton class="h-9 w-40 rounded-2xl rounded-bl-md" />
          <USkeleton class="h-16 w-52 rounded-2xl rounded-br-md ml-auto" />
        </div>

        <!-- thread -->
        <div
          v-else
          ref="threadEl"
          class="flex-1 overflow-y-auto px-5 py-5 space-y-3 bg-grid"
        >
          <template
            v-for="m in cr.messages.value"
            :key="m.id"
          >
            <!-- system -->
            <div
              v-if="m.sender_type === 'system'"
              class="flex justify-center"
            >
              <span class="rounded-full bg-elevated ring-1 ring-default px-3 py-1 text-[11px] text-muted">{{ m.content }}</span>
            </div>
            <!-- internal note -->
            <div
              v-else-if="m.is_internal_note"
              class="flex justify-center"
            >
              <div class="max-w-[80%] rounded-xl bg-inverted/10 ring-1 ring-inverted/25 px-3.5 py-2 text-sm text-highlighted">
                <p class="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-highlighted mb-1">
                  <UIcon
                    name="i-lucide-lock"
                    class="size-3"
                  /> Internal note · {{ cr.memberName(m.sender_id) }}
                </p>
                {{ m.content }}
              </div>
            </div>
            <!-- visitor / agent -->
            <div
              v-else
              class="flex items-end gap-2"
              :class="m.sender_type === 'agent' ? 'flex-row-reverse' : ''"
            >
              <span
                v-if="m.sender_type === 'agent'"
                class="grid place-items-center size-6 shrink-0 rounded-lg bg-inverted/15 ring-1 ring-inverted/25 text-[10px] font-semibold text-highlighted"
              >{{ initials(cr.memberName(m.sender_id), 'A') }}</span>
              <div
                class="max-w-[72%] rounded-2xl px-3.5 py-2 text-sm leading-snug"
                :class="m.sender_type === 'agent'
                  ? 'bg-inverted text-inverted rounded-br-md'
                  : 'bg-default ring-1 ring-default text-highlighted rounded-bl-md'"
              >
                {{ m.content }}
              </div>
            </div>
          </template>

          <div
            v-if="cr.visitorTyping.value"
            class="flex items-center gap-1 text-xs text-dimmed"
          >
            <UIcon
              name="i-lucide-more-horizontal"
              class="size-4 animate-pulse"
            /> visitor is typing…
          </div>
        </div>

        <!-- composer -->
        <div class="shrink-0 border-t border-default bg-default p-3">
          <div
            class="rounded-xl ring-1 transition-colors"
            :class="internalNote ? 'ring-inverted/40 bg-inverted/5' : 'ring-default bg-elevated/40'"
          >
            <UTextarea
              v-model="reply"
              :rows="2"
              autoresize
              variant="none"
              :placeholder="internalNote ? 'Write an internal note (agents only)…' : 'Reply to the visitor…'"
              class="w-full"
              @keydown.enter.exact.prevent="onSend"
            />
            <div class="flex items-center gap-2 px-2.5 pb-2">
              <USwitch
                v-model="internalNote"
                size="sm"
              />
              <span
                class="text-xs"
                :class="internalNote ? 'text-highlighted font-medium' : 'text-muted'"
              >Internal note</span>
              <UButton
                class="ml-auto"
                size="sm"
                :color="internalNote ? 'neutral' : 'neutral'"
                icon="i-lucide-send-horizontal"
                :loading="sending"
                :disabled="!reply.trim()"
                @click="onSend"
              >
                Send
              </UButton>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
