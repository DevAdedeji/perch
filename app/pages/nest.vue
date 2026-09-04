<script setup lang="ts">
import type { ServerEvent } from '@perch/shared'
import { activeMention, insertMention, mentionSegments, selectedMentionIds } from '~/utils/mentions'

definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Nest · Perch' })

interface NestMessage {
  id: string
  client_message_id?: string | null
  member_id: string
  member_name: string
  content: string
  mentioned_member_ids: string[]
  created_at: string
  pending?: boolean
}

const { currentWorkspace, user } = useAuth()
const toast = useToast()
const rt = useRealtime()

const wid = computed(() => currentWorkspace.value?.workspaceId ?? null)
const myMemberId = computed(() => currentWorkspace.value?.memberId ?? null)

// cached across navigation — the room re-renders instantly on return
const thread = useState<NestMessage[]>('nest:messages', () => [])
const loading = ref(false)
const draft = ref('')
const threadEl = ref<HTMLElement | null>(null)
interface NestMember { id: string, name: string, presence: 'online' | 'away' | 'offline' }
const members = ref<NestMember[]>([])
const onlineNames = computed(() => members.value.filter(member => member.presence === 'online').map(member => member.name))
const pendingMessageId = useState<string | null>('nest:pendingMessage', () => null)
const highlightedMessageId = ref<string | null>(null)
let scopeVersion = 0
let alive = true
let loadVersion = 0
let presenceVersion = 0
const sending = ref(false)
let retryAttempt: { signature: string, id: string } | null = null

async function load() {
  if (!wid.value) return
  const workspaceId = wid.value
  const scope = scopeVersion
  const version = ++loadVersion
  if (!thread.value.length) loading.value = true
  try {
    const data = await $fetch<NestMessage[]>(`/api/workspaces/${workspaceId}/team-chat`)
    if (!alive || scope !== scopeVersion || version !== loadVersion || workspaceId !== wid.value) return
    const unsent = thread.value.filter(message => message.pending)
    thread.value = [...data, ...unsent.filter(message => !data.some(saved => saved.client_message_id === message.client_message_id))]
    scrollDown()
  } finally {
    if (scope === scopeVersion && version === loadVersion) loading.value = false
  }
}

async function loadPresence() {
  if (!wid.value) return
  const workspaceId = wid.value
  const scope = scopeVersion
  const version = ++presenceVersion
  try {
    const data = await $fetch<NestMember[]>(`/api/workspaces/${workspaceId}/members`)
    if (alive && scope === scopeVersion && version === presenceVersion && workspaceId === wid.value) members.value = data
  } catch {
    // decorative
  }
}

const pickedMentions = new Map<string, string>()
const mentionIndex = ref(0)
const currentMention = computed(() => activeMention(draft.value))
const mentionMatches = computed(() => currentMention.value === null
  ? []
  : members.value
      .filter(member => member.id !== myMemberId.value && member.name.toLowerCase().includes(currentMention.value!.query))
      .slice(0, 6))
const mentionOpen = computed(() => mentionMatches.value.length > 0)

watch(currentMention, () => {
  mentionIndex.value = 0
})

function applyMention(member: NestMember) {
  if (!currentMention.value) return
  const token = `@${member.name}`
  draft.value = insertMention(draft.value, currentMention.value, member.name)
  pickedMentions.set(member.id, token)
}

function onComposerKeydown(event: KeyboardEvent) {
  if (mentionOpen.value) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      mentionIndex.value = (mentionIndex.value + 1) % mentionMatches.value.length
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      mentionIndex.value = (mentionIndex.value - 1 + mentionMatches.value.length) % mentionMatches.value.length
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      applyMention(mentionMatches.value[mentionIndex.value]!)
      return
    }
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    send()
  }
}

async function scrollDown(smooth = false) {
  await nextTick()
  threadEl.value?.scrollTo({ top: threadEl.value.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
}

function onEvent(ev: ServerEvent) {
  if (ev.type !== 'team.message' || ev.payload.workspace_id !== wid.value) return
  if (ev.payload.member_id === myMemberId.value && ev.payload.client_message_id === retryAttempt?.id) retryAttempt = null
  // our own optimistic bubble reconciles in place; teammates' just append
  const pendingIdx = thread.value.findIndex(m => m.pending && ev.payload.client_message_id && m.client_message_id === ev.payload.client_message_id && m.member_id === ev.payload.member_id)
  if (pendingIdx !== -1) {
    thread.value.splice(pendingIdx, 1, ev.payload)
  } else if (!thread.value.some(m => m.id === ev.payload.id)) {
    thread.value.push(ev.payload)
    scrollDown(true)
  }
}

async function send() {
  const content = draft.value.trim()
  if (!content || !wid.value || sending.value) return
  const workspaceId = wid.value
  const scope = scopeVersion
  const mentionedMemberIds = selectedMentionIds(content, pickedMentions)
  const signature = JSON.stringify([workspaceId, myMemberId.value, content, [...mentionedMemberIds].sort()])
  if (retryAttempt?.signature !== signature) retryAttempt = { signature, id: crypto.randomUUID() }
  const requestId = retryAttempt.id
  sending.value = true
  draft.value = ''
  const tempId = `temp-${requestId}`
  thread.value.push({
    id: tempId,
    client_message_id: requestId,
    member_id: myMemberId.value ?? '',
    member_name: user.value?.name ?? 'Me',
    content,
    mentioned_member_ids: mentionedMemberIds,
    created_at: new Date().toISOString(),
    pending: true
  })
  scrollDown(true)
  try {
    const msg = await $fetch<NestMessage>(`/api/workspaces/${workspaceId}/team-chat`, {
      method: 'POST',
      body: { content, mentioned_member_ids: mentionedMemberIds, client_message_id: requestId }
    })
    if (!alive || scope !== scopeVersion || workspaceId !== wid.value) return
    const idx = thread.value.findIndex(m => m.id === tempId)
    if (thread.value.some(m => m.id === msg.id)) {
      if (idx !== -1) thread.value.splice(idx, 1)
    } else if (idx !== -1) {
      thread.value.splice(idx, 1, msg)
    }
    pickedMentions.clear()
    retryAttempt = null
  } catch (e) {
    if (!alive || scope !== scopeVersion || workspaceId !== wid.value) return
    if (thread.value.some(message => !message.pending && message.client_message_id === requestId)) {
      retryAttempt = null
      return
    }
    thread.value = thread.value.filter(m => m.id !== tempId)
    if (!draft.value) draft.value = content
    toast.add({ title: getErrorMessage(e, 'Could not send'), color: 'error' })
  } finally {
    if (scope === scopeVersion) sending.value = false
  }
}

function memberName(id: string) {
  return members.value.find(member => member.id === id)?.name ?? null
}

function messageSegments(message: NestMessage) {
  return mentionSegments(message.content, message.mentioned_member_ids, memberName)
}

async function focusPendingMessage() {
  const id = pendingMessageId.value
  if (!id) return
  await nextTick()
  document.getElementById(`nest-message-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  highlightedMessageId.value = id
  pendingMessageId.value = null
  window.setTimeout(() => {
    if (highlightedMessageId.value === id) highlightedMessageId.value = null
  }, 2500)
}

// the workspace channel is owned by the dashboard layout; we just listen
let off: (() => void) | undefined
onMounted(() => {
  rt.connect()
  off = rt.on(onEvent)
  load()
  loadPresence()
  focusPendingMessage()
})
onBeforeUnmount(() => {
  alive = false
  scopeVersion++
  off?.()
})
watch([wid, myMemberId], () => {
  scopeVersion++
  thread.value = []
  members.value = []
  draft.value = ''
  pickedMentions.clear()
  retryAttempt = null
  sending.value = false
  loading.value = false
  load()
  loadPresence()
}, { flush: 'sync' })
watch([() => thread.value.length, pendingMessageId], focusPendingMessage)

/* rows: day dividers + grouping (same rhythm as the inbox thread) */
interface MsgRow { kind: 'msg', m: NestMessage, first: boolean }
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

const rows = computed<(MsgRow | DayRow)[]>(() => {
  const out: (MsgRow | DayRow)[] = []
  for (let i = 0; i < thread.value.length; i++) {
    const m = thread.value[i]!
    const prev = thread.value[i - 1]
    const day = dayLabel(m.created_at)
    const newDay = !prev || dayLabel(prev.created_at) !== day
    if (newDay) out.push({ kind: 'day', id: `day-${m.id}`, label: day })
    const sameGroup = !!prev && prev.member_id === m.member_id
      && Math.abs(+new Date(m.created_at) - +new Date(prev.created_at)) < 5 * 60_000
    out.push({ kind: 'msg', m, first: newDay || !sameGroup })
  }
  return out
})

function initials(n: string) {
  return n.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- header -->
    <div class="shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-default bg-default">
      <span class="grid place-items-center size-9 rounded-xl avatar-primary">
        <UIcon
          name="i-lucide-bird"
          class="size-5"
        />
      </span>
      <div class="min-w-0 flex-1">
        <h1 class="font-display text-base font-bold text-highlighted leading-tight">
          Nest
        </h1>
        <p class="text-xs text-muted truncate">
          Your team's own space — visitors never see this.
        </p>
      </div>
      <span
        v-if="onlineNames.length"
        class="hidden sm:flex items-center gap-1.5 text-[11px] text-dimmed"
        :title="onlineNames.join(', ')"
      >
        <span class="size-1.5 rounded-full bg-green-500" />
        {{ onlineNames.length }} online
      </span>
    </div>

    <!-- thread -->
    <div
      ref="threadEl"
      class="flex-1 overflow-y-auto px-5 py-5 bg-grid"
    >
      <div
        v-if="loading"
        class="space-y-3 max-w-2xl mx-auto"
      >
        <USkeleton class="h-12 w-72 rounded-xl" />
        <USkeleton class="h-12 w-96 rounded-xl" />
        <USkeleton class="h-12 w-64 rounded-xl" />
      </div>

      <div
        v-else-if="!thread.length"
        class="h-full flex flex-col items-center justify-center text-center gap-1"
      >
        <span class="grid place-items-center size-12 rounded-2xl avatar-primary mb-2">
          <UIcon
            name="i-lucide-bird"
            class="size-6"
          />
        </span>
        <p class="font-display text-base font-semibold text-highlighted">
          Welcome to the Nest
        </p>
        <p class="text-sm text-muted max-w-64">
          Coordinate, hand off, or just say hi — this room is only ever your team.
        </p>
      </div>

      <div
        v-else
        class="max-w-2xl mx-auto"
      >
        <template
          v-for="row in rows"
          :key="row.kind === 'day' ? row.id : row.m.id"
        >
          <p
            v-if="row.kind === 'day'"
            class="text-center text-[10px] font-semibold uppercase tracking-wider text-dimmed mt-5 mb-2 first:mt-0"
          >
            {{ row.label }}
          </p>

          <div
            v-else
            :id="`nest-message-${row.m.id}`"
            class="flex items-start gap-2.5"
            :class="[
              row.first ? 'mt-3' : 'mt-0.5',
              { 'opacity-60': row.m.pending }
            ]"
          >
            <span
              v-if="row.first"
              class="grid place-items-center size-8 shrink-0 rounded-xl avatar-primary text-[11px] font-bold"
            >
              {{ initials(row.m.member_name) }}
            </span>
            <span
              v-else
              class="w-8 shrink-0"
            />
            <div
              class="min-w-0 max-w-[min(100%,36rem)] rounded-xl px-3.5 py-2 ring-1 shadow-sm transition-all"
              :class="[
                row.m.member_id === myMemberId
                  ? 'bg-primary-500/10 ring-primary-500/25'
                  : 'bg-elevated/80 ring-default',
                row.first ? 'rounded-tl-md' : '',
                highlightedMessageId === row.m.id
                  ? 'bg-primary-500/15 ring-2 ring-primary-500/60 shadow-primary-500/10'
                  : ''
              ]"
            >
              <p
                v-if="row.first"
                class="mb-1 text-xs"
              >
                <span class="font-semibold text-highlighted">{{ row.m.member_id === myMemberId ? 'You' : row.m.member_name }}</span>
                <span class="ml-1.5 text-[10px] text-dimmed">{{ formatTime(row.m.created_at) }}</span>
              </p>
              <p class="text-sm text-default leading-relaxed whitespace-pre-wrap wrap-break-word">
                <template
                  v-for="(segment, index) in messageSegments(row.m)"
                  :key="index"
                >
                  <span :class="segment.mention ? 'rounded bg-primary-500/15 px-0.5 font-semibold text-primary-700 dark:text-primary-300' : ''">{{ segment.text }}</span>
                </template>
              </p>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- composer -->
    <div class="shrink-0 border-t border-default bg-default p-3">
      <div class="relative max-w-2xl mx-auto flex items-center gap-2">
        <div
          v-if="mentionOpen"
          class="absolute bottom-full left-0 right-12 z-10 mb-2 overflow-hidden rounded-xl bg-default ring-1 ring-default shadow-xl shadow-black/10"
        >
          <p class="px-3 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-dimmed">
            Mention a teammate
          </p>
          <ul class="max-h-56 overflow-y-auto pb-1">
            <li
              v-for="(member, index) in mentionMatches"
              :key="member.id"
            >
              <button
                type="button"
                class="w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
                :class="index === mentionIndex ? 'bg-primary-500/10 text-highlighted' : 'text-muted hover:bg-elevated'"
                @mousedown.prevent="applyMention(member)"
              >
                <span
                  class="size-1.5 rounded-full"
                  :class="member.presence === 'online' ? 'bg-green-500' : member.presence === 'away' ? 'bg-amber-400' : 'bg-zinc-500'"
                />
                {{ member.name }}
              </button>
            </li>
          </ul>
        </div>
        <UInput
          v-model="draft"
          class="flex-1"
          placeholder="Message the team… Use @ to mention someone"
          size="lg"
          @keydown="onComposerKeydown"
        />
        <UButton
          color="primary"
          size="lg"
          icon="i-lucide-arrow-up"
          square
          aria-label="Send"
          :disabled="!draft.trim() || sending"
          :loading="sending"
          @click="send"
        />
      </div>
    </div>
  </div>
</template>
