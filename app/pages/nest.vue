<script setup lang="ts">
import type { ServerEvent } from '@perch/shared'

definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Nest · Perch' })

interface NestMessage {
  id: string
  member_id: string
  member_name: string
  content: string
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
const onlineNames = ref<string[]>([])

async function load() {
  if (!wid.value) return
  if (!thread.value.length) loading.value = true
  try {
    thread.value = await $fetch<NestMessage[]>(`/api/workspaces/${wid.value}/team-chat`)
    scrollDown()
  } finally {
    loading.value = false
  }
}

async function loadPresence() {
  if (!wid.value) return
  try {
    const members = await $fetch<{ name: string, presence: string }[]>(`/api/workspaces/${wid.value}/members`)
    onlineNames.value = members.filter(m => m.presence === 'online').map(m => m.name)
  } catch {
    // decorative
  }
}

async function scrollDown(smooth = false) {
  await nextTick()
  threadEl.value?.scrollTo({ top: threadEl.value.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
}

function onEvent(ev: ServerEvent) {
  if (ev.type !== 'team.message' || ev.payload.workspace_id !== wid.value) return
  // our own optimistic bubble reconciles in place; teammates' just append
  const pendingIdx = thread.value.findIndex(m => m.pending && m.content === ev.payload.content && m.member_id === ev.payload.member_id)
  if (pendingIdx !== -1) {
    thread.value.splice(pendingIdx, 1, ev.payload)
  } else if (!thread.value.some(m => m.id === ev.payload.id)) {
    thread.value.push(ev.payload)
    scrollDown(true)
  }
}

async function send() {
  const content = draft.value.trim()
  if (!content || !wid.value) return
  draft.value = ''
  const tempId = `temp-${Date.now()}`
  thread.value.push({
    id: tempId,
    member_id: myMemberId.value ?? '',
    member_name: user.value?.name ?? 'Me',
    content,
    created_at: new Date().toISOString(),
    pending: true
  })
  scrollDown(true)
  try {
    const msg = await $fetch<NestMessage>(`/api/workspaces/${wid.value}/team-chat`, {
      method: 'POST',
      body: { content }
    })
    const idx = thread.value.findIndex(m => m.id === tempId)
    if (thread.value.some(m => m.id === msg.id)) {
      if (idx !== -1) thread.value.splice(idx, 1)
    } else if (idx !== -1) {
      thread.value.splice(idx, 1, msg)
    }
  } catch (e) {
    thread.value = thread.value.filter(m => m.id !== tempId)
    draft.value = content
    toast.add({ title: getErrorMessage(e, 'Could not send'), color: 'error' })
  }
}

// the workspace channel is owned by the dashboard layout; we just listen
let off: (() => void) | undefined
onMounted(() => {
  rt.connect()
  off = rt.on(onEvent)
  load()
  loadPresence()
})
onBeforeUnmount(() => off?.())
watch(wid, () => {
  thread.value = []
  load()
  loadPresence()
})

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
      <span class="grid place-items-center size-9 rounded-xl avatar-amber">
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
        <span class="grid place-items-center size-12 rounded-2xl avatar-amber mb-2">
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
            class="flex items-start gap-2.5"
            :class="[row.first ? 'mt-3' : 'mt-0.5', { 'opacity-60': row.m.pending }]"
          >
            <span
              v-if="row.first"
              class="grid place-items-center size-8 shrink-0 rounded-xl avatar-amber text-[11px] font-bold"
            >
              {{ initials(row.m.member_name) }}
            </span>
            <span
              v-else
              class="w-8 shrink-0"
            />
            <div class="min-w-0">
              <p
                v-if="row.first"
                class="text-xs"
              >
                <span class="font-semibold text-highlighted">{{ row.m.member_id === myMemberId ? 'You' : row.m.member_name }}</span>
                <span class="ml-1.5 text-[10px] text-dimmed">{{ formatTime(row.m.created_at) }}</span>
              </p>
              <p class="mt-0.5 text-sm text-default leading-relaxed whitespace-pre-wrap wrap-break-word">
                {{ row.m.content }}
              </p>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- composer -->
    <div class="shrink-0 border-t border-default bg-default p-3">
      <div class="max-w-2xl mx-auto flex items-center gap-2">
        <UInput
          v-model="draft"
          class="flex-1"
          placeholder="Message the team…"
          size="lg"
          @keyup.enter="send"
        />
        <UButton
          color="primary"
          size="lg"
          icon="i-lucide-arrow-up"
          square
          aria-label="Send"
          :disabled="!draft.trim()"
          @click="send"
        />
      </div>
    </div>
  </div>
</template>
