<script setup lang="ts">
definePageMeta({ layout: false })
useHead({ title: 'Chat', meta: [{ name: 'robots', content: 'noindex' }] })

const route = useRoute()
const siteId = computed(() => (route.query.site_id as string) || '')
const perchUrl = useRequestURL().origin

const widget = useWidget(siteId.value)
const {
  workspace, agentName, businessOnline, conversationId, messages, status, agentTyping, visitorName
} = widget

type ChatMessage = (typeof messages)['value'][number]

const { uploading, uploadImage } = useImageUpload()
const fileEl = ref<HTMLInputElement | null>(null)
const uploadError = ref('')

function pickImage() {
  fileEl.value?.click()
}

async function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploadError.value = ''
  try {
    const img = await uploadImage(file, { site_id: siteId.value, visitor_id: widget.visitorId.value })
    await widget.sendMessage('', undefined, img)
  } catch (err) {
    uploadError.value = (err as Error).message || 'Could not upload the image'
    setTimeout(() => (uploadError.value = ''), 4000)
  }
}

const draft = ref('')
const prechat = reactive({ name: '', email: '', message: '' })
const sending = ref(false)
const isOpen = ref(false) // the loader tells us when we're revealed
const unread = ref(0)
const threadEl = ref<HTMLElement | null>(null)
const composerEl = ref<HTMLTextAreaElement | null>(null)
const composerFocused = ref(false)

const showPrechat = computed(() =>
  status.value === 'ready'
  && !!workspace.value?.prechat_enabled
  && !conversationId.value
  && !visitorName.value
)

/* ── theming: everything derives from the workspace accent ── */
const accent = computed(() => workspace.value?.color || '#0f172a')
const onAccent = computed(() => {
  const c = accent.value.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#0f172a' : '#ffffff'
})

function initial(name: string | null | undefined) {
  return (name || 'A').charAt(0).toUpperCase()
}

function post(msg: Record<string, unknown>) {
  window.parent?.postMessage({ source: 'perch-widget', ...msg }, '*')
}

// hand the brand color to the loader so the launcher bubble matches
watch(workspace, (w) => {
  if (w) post({ perch: 'config', color: accent.value, fg: onAccent.value })
}, { immediate: true })

/* ── message grouping: consecutive same-sender messages within 5 min ── */
interface MsgRow { kind: 'msg', m: ChatMessage, first: boolean, last: boolean }
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

function sameGroup(a: ChatMessage, b: ChatMessage) {
  return a.sender_type === b.sender_type
    && Math.abs(+new Date(b.created_at) - +new Date(a.created_at)) < 5 * 60_000
}

const rows = computed<(MsgRow | DayRow)[]>(() => {
  const list = messages.value
  const out: (MsgRow | DayRow)[] = []
  for (let i = 0; i < list.length; i++) {
    const m = list[i]!
    const prev = list[i - 1]
    const next = list[i + 1]
    const day = dayLabel(m.created_at)
    const newDay = !prev || dayLabel(prev.created_at) !== day
    if (newDay) out.push({ kind: 'day', id: `day-${m.id}`, label: day })
    out.push({
      kind: 'msg',
      m,
      first: newDay || !prev || !sameGroup(prev, m),
      last: !next || !sameGroup(m, next) || dayLabel(next.created_at) !== day
    })
  }
  return out
})

function bubbleShape(row: MsgRow) {
  return row.m.sender_type === 'visitor'
    ? ['rounded-2xl rounded-br-md', !row.first && 'rounded-tr-md']
    : ['rounded-2xl rounded-bl-md', !row.first && 'rounded-tl-md']
}

async function scrollToBottom(smooth = false) {
  await nextTick()
  threadEl.value?.scrollTo({ top: threadEl.value.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
}

/* ── composer ───────────────────────────── */
function autogrow() {
  const el = composerEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
}

let typingTimer: ReturnType<typeof setTimeout> | undefined
let typingOn = false
function onInput() {
  autogrow()
  if (!typingOn) {
    typingOn = true
    widget.sendTyping(true)
  }
  clearTimeout(typingTimer)
  typingTimer = setTimeout(() => {
    typingOn = false
    widget.sendTyping(false)
  }, 1500)
}
function stopTyping() {
  clearTimeout(typingTimer)
  if (typingOn) {
    typingOn = false
    widget.sendTyping(false)
  }
}
function onComposerBlur() {
  composerFocused.value = false
  stopTyping()
}

/* ── send ───────────────────────────────── */
async function onSend() {
  const text = draft.value.trim()
  if (!text) return
  draft.value = '' // clear instantly — the message appears optimistically
  nextTick(autogrow)
  stopTyping()
  try {
    await widget.sendMessage(text)
  } catch {
    draft.value = text // restore on failure
  }
}

async function onPrechatSubmit() {
  const text = prechat.message.trim()
  if (!text || sending.value) return
  sending.value = true
  try {
    await widget.sendMessage(text, {
      name: prechat.name.trim() || undefined,
      email: prechat.email.trim() || undefined
    })
  } finally {
    sending.value = false
  }
}

async function retry() {
  status.value = 'loading'
  await widget.start()
}

function close() {
  post({ perch: 'close' })
}

/* ── unread badge + open/close from the loader ── */
watch(() => messages.value.length, () => {
  scrollToBottom(true)
  const last = messages.value[messages.value.length - 1]
  if (last && last.sender_type === 'agent' && !isOpen.value) {
    unread.value++
    post({ perch: 'unread', count: unread.value })
  }
})
watch(agentTyping, (v) => {
  if (v) scrollToBottom(true)
})

function onParentMessage(e: MessageEvent) {
  const data = e.data
  if (!data || data.source !== 'perch-host') return
  if (data.perch === 'open') {
    isOpen.value = true
    unread.value = 0
    post({ perch: 'unread', count: 0 })
    scrollToBottom()
    // focus the composer on open — desktop only (mobile would pop the keyboard)
    if (window.matchMedia('(pointer: fine)').matches) nextTick(() => composerEl.value?.focus())
  } else if (data.perch === 'close') {
    isOpen.value = false
  } else if (data.perch === 'identify') {
    // the host site told us who its signed-in user is — skip pre-chat
    widget.identify({ user_id: data.user_id, name: data.name, email: data.email, hash: data.hash })
  }
}

onMounted(async () => {
  window.addEventListener('message', onParentMessage)
  await widget.start()
  post({ perch: 'ready' })
  scrollToBottom()
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onParentMessage)
  widget.stop()
})
</script>

<template>
  <div class="h-screen flex flex-col bg-default text-default overflow-hidden">
    <!-- header -->
    <header class="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-default bg-elevated/50">
      <span class="relative shrink-0">
        <span
          class="grid place-items-center size-9 rounded-xl overflow-hidden text-sm font-bold"
          :style="{ background: `${accent}1f`, color: accent, boxShadow: `inset 0 0 0 1px ${accent}4d` }"
        >
          <img
            v-if="workspace?.logo_url"
            :src="workspace.logo_url"
            class="size-full object-cover"
            alt=""
          >
          <template v-else>{{ initial(agentName || workspace?.name) }}</template>
        </span>
        <span
          class="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full"
          :class="businessOnline && 'pulse-dot'"
          :style="{ background: businessOnline ? '#22c55e' : '#94a3b8', border: '2px solid var(--ui-bg-elevated)' }"
        />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-highlighted leading-tight truncate">
          {{ agentName || workspace?.name || 'Chat' }}
        </p>
        <p class="text-xs text-muted truncate">
          <template v-if="agentName">
            from {{ workspace?.name }}
          </template>
          <template v-else>
            {{ businessOnline ? 'Online · replies in seconds' : 'Away — we’ll reply as soon as we’re back' }}
          </template>
        </p>
      </div>
      <button
        class="grid place-items-center size-8 rounded-full text-dimmed hover:text-highlighted hover:bg-elevated active:scale-95 transition"
        aria-label="Close"
        @click="close"
      >
        <UIcon
          name="i-lucide-x"
          class="size-5"
        />
      </button>
    </header>

    <!-- loading -->
    <div
      v-if="status === 'loading'"
      class="flex-1 grid place-items-center"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-6 animate-spin text-dimmed"
      />
    </div>

    <!-- error -->
    <div
      v-else-if="status === 'error'"
      class="flex-1 grid place-items-center p-6 text-center"
    >
      <div>
        <UIcon
          name="i-lucide-triangle-alert"
          class="size-7 text-dimmed mx-auto"
        />
        <p class="mt-2 text-sm text-muted">
          Couldn’t load chat.
        </p>
        <button
          class="mt-4 rounded-xl px-4 py-2 text-sm font-semibold hover:brightness-110 active:scale-[.98] transition"
          :style="{ background: accent, color: onAccent }"
          @click="retry"
        >
          Try again
        </button>
      </div>
    </div>

    <!-- pre-chat form -->
    <form
      v-else-if="showPrechat"
      class="flex-1 flex flex-col p-5 gap-3.5 overflow-y-auto"
      @submit.prevent="onPrechatSubmit"
    >
      <div class="mb-1">
        <span
          class="grid place-items-center size-11 rounded-2xl mb-3"
          :style="{ background: `${accent}1a`, color: accent }"
        >
          <UIcon
            name="i-lucide-messages-square"
            class="size-5"
          />
        </span>
        <p class="font-display text-lg font-semibold text-highlighted">
          Hi there 👋
        </p>
        <p class="mt-1 text-sm text-muted">
          Tell us a bit about you and how we can help.
        </p>
      </div>
      <input
        v-model="prechat.name"
        type="text"
        placeholder="Your name"
        class="w-full rounded-xl bg-elevated ring-1 ring-default px-3.5 py-2.5 text-sm outline-none focus:ring-2 transition-shadow"
        :style="{ '--tw-ring-color': accent }"
      >
      <input
        v-model="prechat.email"
        type="email"
        placeholder="Email (optional)"
        class="w-full rounded-xl bg-elevated ring-1 ring-default px-3.5 py-2.5 text-sm outline-none focus:ring-2 transition-shadow"
        :style="{ '--tw-ring-color': accent }"
      >
      <textarea
        v-model="prechat.message"
        rows="3"
        placeholder="What do you need help with?"
        class="w-full rounded-xl bg-elevated ring-1 ring-default px-3.5 py-2.5 text-sm outline-none focus:ring-2 resize-none transition-shadow"
        :style="{ '--tw-ring-color': accent }"
      />
      <button
        type="submit"
        class="mt-auto rounded-xl py-3 text-sm font-semibold shadow-lg hover:brightness-110 active:scale-[.99] transition disabled:opacity-60 disabled:shadow-none"
        :style="{ background: accent, color: onAccent }"
        :disabled="!prechat.message.trim() || sending"
      >
        {{ sending ? 'Starting…' : 'Start chat' }}
      </button>
    </form>

    <!-- chat -->
    <template v-else>
      <div
        ref="threadEl"
        class="flex-1 overflow-y-auto px-4 py-4 overscroll-contain bg-grid"
      >
        <!-- greeting / empty state -->
        <div
          v-if="!messages.length"
          class="h-full flex flex-col items-center justify-center text-center px-4 gap-1"
        >
          <span
            class="grid place-items-center size-12 rounded-2xl mb-2 overflow-hidden"
            :style="{ background: `${accent}1a`, color: accent }"
          >
            <img
              v-if="workspace?.logo_url"
              :src="workspace.logo_url"
              class="size-full object-cover"
              alt=""
            >
            <UIcon
              v-else
              name="i-lucide-hand"
              class="size-6"
            />
          </span>
          <p class="font-display text-base font-semibold text-highlighted">
            Hi{{ visitorName ? ` ${visitorName}` : ' there' }} 👋
          </p>
          <p class="text-sm text-muted max-w-60">
            {{ businessOnline
              ? 'Ask us anything — we’re online and typically reply in a few minutes.'
              : 'We’re away right now, but leave a message and we’ll get back to you.' }}
          </p>
        </div>

        <template
          v-for="row in rows"
          :key="row.kind === 'day' ? row.id : row.m.id"
        >
          <!-- day divider -->
          <p
            v-if="row.kind === 'day'"
            class="text-center text-[10px] font-semibold uppercase tracking-wider text-dimmed mt-4 mb-2 first:mt-0"
          >
            {{ row.label }}
          </p>

          <!-- message -->
          <div
            v-else
            class="msg-in"
            :class="row.first ? 'mt-2.5' : 'mt-0.5'"
          >
            <div
              class="flex items-end gap-2"
              :class="row.m.sender_type === 'visitor' ? 'flex-row-reverse' : ''"
            >
              <!-- agent avatar (only on the last message of a group) -->
              <template v-if="row.m.sender_type !== 'visitor'">
                <span
                  v-if="row.last"
                  class="grid place-items-center size-6 shrink-0 rounded-lg overflow-hidden text-[10px] font-semibold"
                  :style="{ background: `${accent}22`, color: accent }"
                >
                  <img
                    v-if="workspace?.logo_url"
                    :src="workspace.logo_url"
                    class="size-full object-cover"
                    alt=""
                  >
                  <template v-else>{{ initial(agentName || workspace?.name) }}</template>
                </span>
                <span
                  v-else
                  class="w-6 shrink-0"
                />
              </template>

              <div
                class="max-w-[78%] px-3.5 py-2 text-sm leading-snug shadow-sm whitespace-pre-wrap wrap-break-word transition-opacity"
                :class="[
                  ...bubbleShape(row),
                  row.m.sender_type === 'visitor' ? '' : 'bg-elevated ring-1 ring-default text-highlighted',
                  { 'opacity-60': row.m.pending }
                ]"
                :style="row.m.sender_type === 'visitor' ? { background: accent, color: onAccent } : {}"
              >
                <a
                  v-if="row.m.attachment_url"
                  :href="row.m.attachment_url"
                  target="_blank"
                  rel="noopener"
                  class="block -mx-2 my-0.5 first:mt-0"
                >
                  <img
                    :src="cldThumb(row.m.attachment_url)"
                    class="rounded-lg max-h-48 w-auto"
                    loading="lazy"
                    alt="Image attachment"
                  >
                </a>
                <template v-if="row.m.content">
                  {{ row.m.content }}
                </template>
              </div>
            </div>
            <!-- group meta: time / sending state -->
            <p
              v-if="row.last"
              class="mt-1 text-[10px] text-dimmed"
              :class="row.m.sender_type === 'visitor' ? 'text-right pr-1' : 'pl-8'"
            >
              {{ row.m.pending ? 'Sending…' : formatTime(row.m.created_at) }}
            </p>
          </div>
        </template>

        <!-- agent typing -->
        <div
          v-if="agentTyping"
          class="flex items-end gap-2 mt-2.5 msg-in"
        >
          <span
            class="grid place-items-center size-6 shrink-0 rounded-lg text-[10px] font-semibold"
            :style="{ background: `${accent}22`, color: accent }"
          >{{ initial(agentName || workspace?.name) }}</span>
          <div class="flex items-center gap-1 rounded-2xl rounded-bl-md bg-elevated ring-1 ring-default px-3.5 py-3">
            <span class="size-1.5 rounded-full bg-dimmed animate-bounce [animation-delay:-0.3s]" />
            <span class="size-1.5 rounded-full bg-dimmed animate-bounce [animation-delay:-0.15s]" />
            <span class="size-1.5 rounded-full bg-dimmed animate-bounce" />
          </div>
        </div>
      </div>

      <!-- composer -->
      <div class="shrink-0 border-t border-default bg-elevated/50 p-3">
        <p
          v-if="!businessOnline && messages.length"
          class="pb-2 text-[11px] text-dimmed text-center"
        >
          We’re away right now — we’ll reply as soon as we’re back.
        </p>
        <p
          v-if="uploadError"
          class="pb-2 text-[11px] text-red-500 text-center"
        >
          {{ uploadError }}
        </p>
        <div class="flex items-end gap-2">
          <input
            ref="fileEl"
            type="file"
            accept="image/*"
            class="hidden"
            @change="onFilePicked"
          >
          <button
            class="grid place-items-center size-9 shrink-0 rounded-xl text-dimmed hover:text-highlighted hover:bg-elevated transition disabled:opacity-50"
            :disabled="uploading"
            aria-label="Attach an image (max 1 MB)"
            @click="pickImage"
          >
            <UIcon
              :name="uploading ? 'i-lucide-loader-circle' : 'i-lucide-image-plus'"
              class="size-5"
              :class="uploading && 'animate-spin'"
            />
          </button>
          <div
            class="flex-1 flex items-end rounded-xl bg-default px-3 py-1 transition-shadow min-w-0"
            :class="composerFocused ? 'ring-2' : 'ring-1 ring-default'"
            :style="composerFocused ? { '--tw-ring-color': accent } : {}"
          >
            <textarea
              ref="composerEl"
              v-model="draft"
              rows="1"
              placeholder="Type a message…"
              class="flex-1 max-h-30 bg-transparent py-1.5 text-sm outline-none resize-none"
              @input="onInput"
              @keydown.enter.exact.prevent="onSend"
              @focus="composerFocused = true"
              @blur="onComposerBlur"
            />
          </div>
          <button
            class="grid place-items-center size-9 shrink-0 rounded-xl transition enabled:hover:brightness-110 enabled:active:scale-90 disabled:opacity-40"
            :style="{ background: accent, color: onAccent }"
            :disabled="!draft.trim()"
            aria-label="Send"
            @click="onSend"
          >
            <UIcon
              name="i-lucide-arrow-up"
              class="size-4"
            />
          </button>
        </div>
      </div>
    </template>

    <!-- persistent branding (free plan) — removable on a paid plan later -->
    <a
      :href="perchUrl"
      target="_blank"
      rel="noopener"
      class="shrink-0 flex items-center justify-center gap-1 py-2 text-[10px] text-dimmed hover:text-muted transition-colors border-t border-default"
    >
      <UIcon
        name="i-lucide-bird"
        class="size-3"
      />
      Powered by <span class="font-semibold">Perch</span>
    </a>
  </div>
</template>

<style scoped>
/* Mobile browsers auto-zoom when a focused field's font-size is < 16px.
   Keep the compact 14px look on desktop; bump to 16px only on touch devices. */
@media (pointer: coarse) {
  textarea,
  input {
    font-size: 16px;
  }
}

.msg-in {
  animation: perch-msg-in 0.18s ease both;
}

@keyframes perch-msg-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

.pulse-dot {
  animation: perch-pulse 2.4s ease-out infinite;
}

@keyframes perch-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.55);
  }

  70%,
  100% {
    box-shadow: 0 0 0 7px rgba(34, 197, 94, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .msg-in,
  .pulse-dot {
    animation: none;
  }
}
</style>
