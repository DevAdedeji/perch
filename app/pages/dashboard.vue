<script setup lang="ts">
import type { MessageDTO } from '@perch/shared'
import type { CannedResponse, InboxFilter } from '~/composables/useControlRoom'

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

/* ── thread rows: grouping + day dividers (mirrors the widget) ── */
type ThreadMsg = MessageDTO & { pending?: boolean }
interface MsgRow { kind: 'msg', m: ThreadMsg, first: boolean, last: boolean }
interface NoteRow { kind: 'note', m: ThreadMsg }
interface SystemRow { kind: 'system', m: ThreadMsg }
interface DayRow { kind: 'day', id: string, label: string }

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function isBubble(m: ThreadMsg) {
  return m.sender_type !== 'system' && !m.is_internal_note
}

function sameGroup(a: ThreadMsg, b: ThreadMsg) {
  return isBubble(a) && isBubble(b)
    && a.sender_type === b.sender_type
    && a.sender_id === b.sender_id
    && Math.abs(+new Date(b.created_at) - +new Date(a.created_at)) < 5 * 60_000
}

const rows = computed<(MsgRow | NoteRow | SystemRow | DayRow)[]>(() => {
  const list = cr.messages.value
  const out: (MsgRow | NoteRow | SystemRow | DayRow)[] = []
  for (let i = 0; i < list.length; i++) {
    const m = list[i]!
    const prev = list[i - 1]
    const next = list[i + 1]
    const day = dayLabel(m.created_at)
    const newDay = !prev || dayLabel(prev.created_at) !== day
    if (newDay) out.push({ kind: 'day', id: `day-${m.id}`, label: day })
    if (m.sender_type === 'system') {
      out.push({ kind: 'system', m })
    } else if (m.is_internal_note) {
      out.push({ kind: 'note', m })
    } else {
      out.push({
        kind: 'msg',
        m,
        first: newDay || !prev || !sameGroup(prev, m),
        last: !next || !sameGroup(m, next) || dayLabel(next.created_at) !== day
      })
    }
  }
  return out
})

function bubbleShape(row: MsgRow) {
  return row.m.sender_type === 'agent'
    ? ['rounded-2xl rounded-br-md', !row.first && 'rounded-tr-md']
    : ['rounded-2xl rounded-bl-md', !row.first && 'rounded-tl-md']
}

// keep the thread pinned to the newest message
const threadEl = ref<HTMLElement | null>(null)
watch(() => cr.messages.value.length, () => {
  nextTick(() => {
    threadEl.value?.scrollTo({ top: threadEl.value.scrollHeight, behavior: 'smooth' })
  })
})
watch(() => cr.loadingThread.value, (loading) => {
  if (!loading) {
    nextTick(() => {
      threadEl.value?.scrollTo({ top: threadEl.value.scrollHeight })
    })
  }
})

/* ── canned responses: type "/" to search templates ── */
const composerEl = ref<{ textareaRef?: HTMLTextAreaElement } | null>(null)
const cannedDismissed = ref(false)
const cannedIndex = ref(0)

const cannedQuery = computed<string | null>(() => {
  const m = reply.value.match(/^\/([a-z0-9-]*)$/i)
  return m ? m[1]!.toLowerCase() : null
})
const cannedMatches = computed<CannedResponse[]>(() =>
  cannedQuery.value === null
    ? []
    : cr.canned.value.filter(c => c.shortcut.startsWith(cannedQuery.value!)).slice(0, 6)
)
const cannedOpen = computed(() => cannedMatches.value.length > 0 && !cannedDismissed.value && !internalNote.value)

watch(cannedQuery, () => {
  cannedIndex.value = 0
  cannedDismissed.value = false
})

function applyCanned(c: CannedResponse) {
  reply.value = c.content
  nextTick(() => composerEl.value?.textareaRef?.focus())
}

function onComposerKeydown(e: KeyboardEvent) {
  if (cannedOpen.value) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      cannedIndex.value = (cannedIndex.value + 1) % cannedMatches.value.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      cannedIndex.value = (cannedIndex.value - 1 + cannedMatches.value.length) % cannedMatches.value.length
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      applyCanned(cannedMatches.value[cannedIndex.value]!)
      return
    }
    if (e.key === 'Escape') {
      cannedDismissed.value = true
      return
    }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    onSend()
  }
}

/* ── actions ── */
async function onSend() {
  const text = reply.value.trim()
  if (!text) return
  const note = internalNote.value
  // clear instantly — the message appears optimistically (see useControlRoom.sendReply)
  reply.value = ''
  internalNote.value = false
  try {
    await cr.sendReply(text, note)
  } catch {
    toast.add({ title: 'Could not send message', color: 'error' })
    reply.value = text
    internalNote.value = note
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

// one accent discipline: amber only where action is needed; the rest are just labels
const statusBadge = {
  unassigned: { color: 'warning' as const, label: 'Unassigned' },
  open: { color: 'neutral' as const, label: 'Open' },
  resolved: { color: 'neutral' as const, label: 'Resolved' }
}
</script>

<template>
  <div class="flex h-full">
    <!-- ── inbox list (full-width on mobile; hidden once a chat is open) ── -->
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

        <div class="mt-3 flex items-center gap-1 overflow-x-auto">
          <button
            v-for="f in filters"
            :key="f.value"
            class="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium whitespace-nowrap transition-colors"
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
              <span class="grid place-items-center size-9 shrink-0 rounded-lg bg-elevated ring-1 ring-default text-xs font-semibold text-muted">
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
                    size="sm"
                  >
                    {{ statusBadge[c.status].label }}
                  </UBadge>
                  <span
                    v-if="c.assignedAgentId"
                    class="truncate text-[10px] text-dimmed"
                  >· {{ cr.memberName(c.assignedAgentId) }}</span>
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
              class="absolute right-3 bottom-2.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              size="xs"
              color="primary"
              icon="i-lucide-hand"
              label="Claim"
              @click.stop="onClaim(c.id)"
            />
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
          <p class="mt-1 text-xs text-dimmed">
            Tip: type <span class="font-mono text-highlighted">/</span> in the composer to insert a canned reply.
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
          <span class="grid place-items-center size-9 rounded-lg bg-amber-500/10 ring-1 ring-amber-500/25 text-sm font-semibold text-amber-600 dark:text-amber-400">
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
              color="primary"
              icon="i-lucide-hand"
              class="font-medium"
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

        <div class="flex-1 flex min-h-0">
          <div class="flex-1 flex flex-col min-w-0">
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
              class="flex-1 overflow-y-auto px-5 py-5 bg-grid"
            >
              <template
                v-for="row in rows"
                :key="row.kind === 'day' ? row.id : row.m.id"
              >
                <!-- day divider -->
                <p
                  v-if="row.kind === 'day'"
                  class="text-center text-[10px] font-semibold uppercase tracking-wider text-dimmed mt-5 mb-3 first:mt-0"
                >
                  {{ row.label }}
                </p>

                <!-- system -->
                <div
                  v-else-if="row.kind === 'system'"
                  class="flex justify-center my-2"
                >
                  <span class="rounded-full bg-elevated ring-1 ring-default px-3 py-1 text-[11px] text-muted">{{ row.m.content }}</span>
                </div>

                <!-- internal note: the sticky note -->
                <div
                  v-else-if="row.kind === 'note'"
                  class="flex justify-end my-2"
                >
                  <div class="max-w-[72%] rounded-xl rounded-br-md bg-amber-500/10 ring-1 ring-amber-500/30 px-3.5 py-2 text-sm text-highlighted whitespace-pre-wrap wrap-break-word">
                    <p class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1">
                      <UIcon
                        name="i-lucide-lock"
                        class="size-3"
                      />
                      Internal note · {{ cr.memberName(row.m.sender_id) }} · {{ formatTime(row.m.created_at) }}
                    </p>
                    {{ row.m.content }}
                  </div>
                </div>

                <!-- visitor / agent -->
                <div
                  v-else
                  :class="row.first ? 'mt-2.5' : 'mt-0.5'"
                >
                  <div
                    class="flex items-end gap-2"
                    :class="row.m.sender_type === 'agent' ? 'flex-row-reverse' : ''"
                  >
                    <template v-if="row.m.sender_type === 'agent'">
                      <span
                        v-if="row.last"
                        class="grid place-items-center size-6 shrink-0 rounded-lg bg-amber-500/15 ring-1 ring-amber-500/30 text-[10px] font-semibold text-amber-700 dark:text-amber-400"
                      >{{ initials(cr.memberName(row.m.sender_id), 'A') }}</span>
                      <span
                        v-else
                        class="w-6 shrink-0"
                      />
                    </template>
                    <div
                      class="max-w-[72%] px-3.5 py-2 text-sm leading-snug whitespace-pre-wrap wrap-break-word transition-opacity"
                      :class="[
                        ...bubbleShape(row),
                        row.m.sender_type === 'agent'
                          ? 'bg-amber-500 text-slate-950 shadow-sm'
                          : 'bg-default ring-1 ring-default text-highlighted',
                        { 'opacity-60': row.m.pending }
                      ]"
                    >
                      {{ row.m.content }}
                    </div>
                  </div>
                  <p
                    v-if="row.last"
                    class="mt-1 text-[10px] text-dimmed"
                    :class="row.m.sender_type === 'agent' ? 'text-right pr-9' : 'pl-1'"
                  >
                    {{ row.m.pending ? 'Sending…' : formatTime(row.m.created_at) }}
                  </p>
                </div>
              </template>

              <!-- visitor typing -->
              <div
                v-if="cr.visitorTyping.value"
                class="flex items-end gap-2 mt-2.5"
              >
                <div class="flex items-center gap-1 rounded-2xl rounded-bl-md bg-default ring-1 ring-default px-3.5 py-3">
                  <span class="size-1.5 rounded-full bg-dimmed animate-bounce [animation-delay:-0.3s]" />
                  <span class="size-1.5 rounded-full bg-dimmed animate-bounce [animation-delay:-0.15s]" />
                  <span class="size-1.5 rounded-full bg-dimmed animate-bounce" />
                </div>
              </div>
            </div>

            <!-- composer -->
            <div class="shrink-0 border-t border-default bg-default p-3">
              <div class="relative">
                <!-- canned response picker -->
                <div
                  v-if="cannedOpen"
                  class="absolute bottom-full left-0 right-0 mb-2 rounded-xl bg-default ring-1 ring-default shadow-xl shadow-black/10 overflow-hidden z-10"
                >
                  <p class="px-3 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-dimmed">
                    Canned replies
                  </p>
                  <ul class="max-h-56 overflow-y-auto pb-1">
                    <li
                      v-for="(c, i) in cannedMatches"
                      :key="c.id"
                    >
                      <button
                        class="w-full flex items-baseline gap-2.5 px-3 py-2 text-left transition-colors"
                        :class="i === cannedIndex ? 'bg-amber-500/10' : 'hover:bg-elevated/60'"
                        @mouseenter="cannedIndex = i"
                        @click="applyCanned(c)"
                      >
                        <span class="shrink-0 font-mono text-xs font-semibold text-amber-700 dark:text-amber-400">/{{ c.shortcut }}</span>
                        <span class="truncate text-xs text-muted">{{ c.content }}</span>
                      </button>
                    </li>
                  </ul>
                </div>

                <div
                  class="rounded-xl ring-1 transition-colors focus-within:ring-2"
                  :class="internalNote
                    ? 'ring-amber-500/40 bg-amber-500/5 focus-within:ring-amber-500/60'
                    : 'ring-default bg-elevated/40 focus-within:ring-amber-500/60'"
                >
                  <UTextarea
                    ref="composerEl"
                    v-model="reply"
                    :rows="2"
                    autoresize
                    variant="none"
                    :placeholder="internalNote ? 'Write an internal note (agents only)…' : 'Reply to the visitor…'"
                    class="w-full"
                    @keydown="onComposerKeydown"
                  />
                  <div class="flex items-center gap-2 px-2.5 pb-2">
                    <USwitch
                      v-model="internalNote"
                      size="sm"
                    />
                    <span
                      class="text-xs"
                      :class="internalNote ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-muted'"
                    >Internal note</span>
                    <span class="hidden sm:block ml-3 text-[11px] text-dimmed">
                      <span class="font-mono">↵</span> send · <span class="font-mono">⇧↵</span> newline · <span class="font-mono">/</span> canned reply
                    </span>
                    <UButton
                      class="ml-auto font-medium"
                      size="sm"
                      color="primary"
                      icon="i-lucide-send-horizontal"
                      :disabled="!reply.trim()"
                      @click="onSend"
                    >
                      {{ internalNote ? 'Add note' : 'Send' }}
                    </UButton>
                  </div>
                </div>
              </div>
            </div>
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
