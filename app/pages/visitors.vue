<script setup lang="ts">
import { channels } from '@perch/shared'
import type { LiveVisitorDTO, ServerEvent } from '@perch/shared'

definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Visitors · Perch' })

const { currentWorkspace } = useAuth()
const toast = useToast()
const rt = useRealtime()

const wid = computed(() => currentWorkspace.value?.workspaceId ?? null)

// cached across navigation — the roster re-renders instantly on return
const roster = useState<LiveVisitorDTO[]>('visitors:live', () => [])
const loading = ref(false)

// ticking clock so "on page 2m" climbs while you watch
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | undefined

async function load() {
  if (!wid.value) return
  if (!roster.value.length) loading.value = true
  try {
    const res = await $fetch<{ visitors: LiveVisitorDTO[] }>(`/api/workspaces/${wid.value}/visitors/live`)
    roster.value = res.visitors.sort((a, b) => b.connected_at - a.connected_at)
  } finally {
    loading.value = false
  }
}

function onEvent(ev: ServerEvent) {
  if (ev.type === 'visitor.online') {
    // upsert — identity updates (Perch.identify) re-announce as visitor.online
    const idx = roster.value.findIndex(v => v.visitor_ref === ev.payload.visitor_ref)
    if (idx !== -1) roster.value.splice(idx, 1, ev.payload)
    else roster.value.unshift(ev.payload)
  } else if (ev.type === 'visitor.offline') {
    roster.value = roster.value.filter(v => v.visitor_ref !== ev.payload.visitor_ref)
  } else if (ev.type === 'visitor.page') {
    const v = roster.value.find(r => r.visitor_ref === ev.payload.visitor_ref)
    if (v) {
      v.page_url = ev.payload.page_url
      v.page_since = ev.payload.page_since
    }
  }
}

let off: (() => void) | undefined
let offReconnect: (() => void) | undefined
onMounted(() => {
  rt.connect()
  if (wid.value) rt.subscribe(channels.visitors(wid.value))
  off = rt.on(onEvent)
  offReconnect = rt.onReconnect(load)
  load()
  tick = setInterval(() => {
    now.value = Date.now()
  }, 5000)
})
onBeforeUnmount(() => {
  if (wid.value) rt.unsubscribe(channels.visitors(wid.value))
  off?.()
  offReconnect?.()
  clearInterval(tick)
})
watch(wid, (next, prev) => {
  if (prev) rt.unsubscribe(channels.visitors(prev))
  if (next) rt.subscribe(channels.visitors(next))
  roster.value = []
  load()
})

/* display helpers */
function displayName(v: LiveVisitorDTO) {
  return v.name || v.email || 'Anonymous'
}

function initials(v: LiveVisitorDTO) {
  const n = v.name || v.email
  if (!n) return '?'
  return n.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

function pagePath(url: string | null) {
  if (!url) return '—'
  try {
    const u = new URL(url)
    return u.pathname + u.search || '/'
  } catch {
    return url
  }
}

function since(epochMs: number) {
  const s = Math.max(0, Math.floor((now.value - epochMs) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

/* start a conversation */
const pendingSelect = useState<string | null>('inbox:pendingSelect', () => null)
const composeFor = ref<LiveVisitorDTO | null>(null)
const composeText = ref('')
const sending = ref(false)

function openCompose(v: LiveVisitorDTO) {
  composeFor.value = v
  composeText.value = ''
}

async function startConversation() {
  const target = composeFor.value
  const message = composeText.value.trim()
  if (!target || !message || !wid.value || sending.value) return
  sending.value = true
  try {
    const res = await $fetch<{ conversation_id: string }>(`/api/workspaces/${wid.value}/conversations`, {
      method: 'POST',
      body: { visitor_ref: target.visitor_ref, message }
    })
    composeFor.value = null
    toast.add({ title: `Message sent to ${displayName(target)}`, icon: 'i-lucide-check', color: 'success' })
    pendingSelect.value = res.conversation_id
    navigateTo('/dashboard')
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not start the conversation'), color: 'error' })
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- header -->
    <div class="shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-default bg-default">
      <span class="grid place-items-center size-9 rounded-xl avatar-amber">
        <UIcon
          name="i-lucide-radar"
          class="size-5"
        />
      </span>
      <div class="min-w-0 flex-1">
        <h1 class="font-display text-base font-bold text-highlighted leading-tight">
          Visitors
        </h1>
        <p class="text-xs text-muted truncate">
          Who's on your site right now — reach out before they ask.
        </p>
      </div>
      <span
        v-if="roster.length"
        class="hidden sm:flex items-center gap-1.5 text-[11px] text-dimmed"
      >
        <span class="size-1.5 rounded-full bg-green-500 animate-pulse" />
        {{ roster.length }} online
      </span>
    </div>

    <!-- roster -->
    <div class="flex-1 overflow-y-auto px-5 py-5 bg-grid">
      <div
        v-if="loading"
        class="space-y-3 max-w-2xl mx-auto"
      >
        <USkeleton class="h-16 w-full rounded-xl" />
        <USkeleton class="h-16 w-full rounded-xl" />
        <USkeleton class="h-16 w-full rounded-xl" />
      </div>

      <div
        v-else-if="!roster.length"
        class="h-full flex flex-col items-center justify-center text-center gap-1"
      >
        <span class="grid place-items-center size-12 rounded-2xl avatar-amber mb-2">
          <UIcon
            name="i-lucide-radar"
            class="size-6"
          />
        </span>
        <p class="font-display text-base font-semibold text-highlighted">
          No one's on your site right now
        </p>
        <p class="text-sm text-muted max-w-72">
          Visitors appear here live the moment they land on a page with your widget.
        </p>
      </div>

      <ul
        v-else
        class="max-w-2xl mx-auto divide-y divide-default/60 rounded-xl ring-1 ring-default bg-default"
      >
        <li
          v-for="v in roster"
          :key="v.visitor_ref"
          class="group flex items-center gap-3 px-4 py-3"
        >
          <span class="relative grid place-items-center size-9 shrink-0 rounded-xl avatar-amber text-[11px] font-bold">
            {{ initials(v) }}
            <span class="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-green-500 ring-2 ring-default" />
          </span>

          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-highlighted truncate flex items-center gap-1.5">
              {{ displayName(v) }}
              <UIcon
                v-if="v.identity_verified"
                name="i-lucide-badge-check"
                class="size-3.5 text-amber-500 shrink-0"
                title="Verified identity"
              />
            </p>
            <p
              class="text-xs text-muted truncate"
              :title="v.page_url ?? undefined"
            >
              <span class="font-mono">{{ pagePath(v.page_url) }}</span>
              <span
                v-if="v.page_url"
                class="text-dimmed"
              > · {{ since(v.page_since) }} here</span>
            </p>
          </div>

          <div class="shrink-0 flex items-center gap-3">
            <span class="hidden sm:block text-[11px] text-dimmed">
              on site {{ since(v.connected_at) }}
            </span>
            <UButton
              size="xs"
              color="primary"
              variant="soft"
              icon="i-lucide-message-circle"
              class="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              @click="openCompose(v)"
            >
              Message
            </UButton>
          </div>
        </li>
      </ul>
    </div>

    <!-- start-conversation modal -->
    <UModal
      :open="!!composeFor"
      :title="composeFor ? `Message ${displayName(composeFor)}` : ''"
      @update:open="(v: boolean) => { if (!v) composeFor = null }"
    >
      <template #body>
        <div class="space-y-3">
          <p
            v-if="composeFor?.page_url"
            class="text-xs text-muted"
          >
            Currently on <span class="font-mono">{{ pagePath(composeFor.page_url) }}</span>
          </p>
          <UTextarea
            v-model="composeText"
            class="w-full"
            :rows="3"
            autofocus
            placeholder="Hi there — anything I can help with?"
            @keydown.meta.enter="startConversation"
          />
          <p class="text-[11px] text-dimmed">
            Opens their chat widget instantly — the conversation lands in your inbox, assigned to you.
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            @click="composeFor = null"
          >
            Cancel
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-send"
            :loading="sending"
            :disabled="!composeText.trim()"
            @click="startConversation"
          >
            Send
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
