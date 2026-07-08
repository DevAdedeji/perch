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

const draft = ref('')
const prechat = reactive({ name: '', email: '', message: '' })
const sending = ref(false)
const isOpen = ref(true)
const unread = ref(0)
const threadEl = ref<HTMLElement | null>(null)

const showPrechat = computed(() =>
  status.value === 'ready'
  && !!workspace.value?.prechat_enabled
  && !conversationId.value
  && !visitorName.value
)

// accent = the workspace's chosen widget color
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

async function scrollToBottom() {
  await nextTick()
  if (threadEl.value) threadEl.value.scrollTop = threadEl.value.scrollHeight
}

/* ── typing ─────────────────────────────── */
let typingTimer: ReturnType<typeof setTimeout> | undefined
let typingOn = false
function onInput() {
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

/* ── send ───────────────────────────────── */
async function onSend() {
  const text = draft.value.trim()
  if (!text) return
  draft.value = '' // clear instantly — the message appears optimistically
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

function close() {
  post({ perch: 'close' })
}

/* ── unread badge + open/close from the loader ── */
watch(() => messages.value.length, () => {
  scrollToBottom()
  const last = messages.value[messages.value.length - 1]
  if (last && last.sender_type === 'agent' && !isOpen.value) {
    unread.value++
    post({ perch: 'unread', count: unread.value })
  }
})

function onParentMessage(e: MessageEvent) {
  const data = e.data
  if (!data || data.source !== 'perch-host') return
  if (data.perch === 'open') {
    isOpen.value = true
    unread.value = 0
    post({ perch: 'unread', count: 0 })
    scrollToBottom()
  } else if (data.perch === 'close') {
    isOpen.value = false
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
    <header
      class="shrink-0 flex items-center gap-3 px-4 h-16"
      :style="{ background: accent, color: onAccent }"
    >
      <span
        class="grid place-items-center size-9 rounded-full overflow-hidden text-sm font-bold shrink-0"
        :style="{ background: 'rgba(255,255,255,0.15)' }"
      >
        <img
          v-if="workspace?.logo_url"
          :src="workspace.logo_url"
          class="size-full object-cover"
          alt=""
        >
        <template v-else>{{ initial(agentName || workspace?.name) }}</template>
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold truncate">
          {{ agentName || workspace?.name || 'Chat' }}
        </p>
        <p class="flex items-center gap-1.5 text-xs opacity-90">
          <span
            class="size-1.5 rounded-full"
            :style="{ background: businessOnline ? '#22c55e' : 'rgba(255,255,255,0.5)' }"
          />
          <template v-if="agentName">
            from {{ workspace?.name }}
          </template>
          <template v-else>
            {{ businessOnline ? 'Online' : 'Away — we’ll reply by email' }}
          </template>
        </p>
      </div>
      <button
        class="grid place-items-center size-8 rounded-full hover:bg-black/10 transition-colors"
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
          Couldn’t load chat. Please try again.
        </p>
      </div>
    </div>

    <!-- pre-chat form -->
    <form
      v-else-if="showPrechat"
      class="flex-1 flex flex-col p-5 gap-4 overflow-y-auto"
      @submit.prevent="onPrechatSubmit"
    >
      <div>
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
        class="w-full rounded-lg bg-elevated ring-1 ring-default px-3 py-2.5 text-sm outline-none focus:ring-2"
        :style="{ '--tw-ring-color': accent }"
      >
      <input
        v-model="prechat.email"
        type="email"
        placeholder="Email (optional)"
        class="w-full rounded-lg bg-elevated ring-1 ring-default px-3 py-2.5 text-sm outline-none focus:ring-2"
      >
      <textarea
        v-model="prechat.message"
        rows="3"
        placeholder="What do you need help with?"
        class="w-full rounded-lg bg-elevated ring-1 ring-default px-3 py-2.5 text-sm outline-none focus:ring-2 resize-none"
      />
      <button
        type="submit"
        class="mt-auto rounded-lg py-2.5 text-sm font-semibold disabled:opacity-60"
        :style="{ background: accent, color: onAccent }"
        :disabled="!prechat.message.trim() || sending"
      >
        Start chat
      </button>
    </form>

    <!-- chat -->
    <template v-else>
      <div
        ref="threadEl"
        class="flex-1 overflow-y-auto px-4 py-4 space-y-2.5"
      >
        <div
          v-if="!messages.length"
          class="h-full grid place-items-center text-center px-6"
        >
          <p class="text-sm text-muted">
            Send a message and we’ll get right back to you.
          </p>
        </div>
        <div
          v-for="m in messages"
          :key="m.id"
          class="flex items-end gap-2"
          :class="m.sender_type === 'visitor' ? 'flex-row-reverse' : ''"
        >
          <span
            v-if="m.sender_type === 'agent'"
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
          <div
            class="max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-snug shadow-sm transition-opacity"
            :class="[
              m.sender_type === 'visitor' ? 'rounded-br-md' : 'bg-elevated ring-1 ring-default text-highlighted rounded-bl-md',
              { 'opacity-60': m.pending }
            ]"
            :style="m.sender_type === 'visitor' ? { background: accent, color: onAccent } : {}"
          >
            {{ m.content }}
          </div>
        </div>
        <div
          v-if="agentTyping"
          class="flex items-end gap-2"
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

      <div class="shrink-0 border-t border-default p-3">
        <div class="flex items-end gap-2">
          <textarea
            v-model="draft"
            rows="1"
            placeholder="Type a message…"
            class="flex-1 max-h-28 rounded-xl bg-elevated ring-1 ring-default px-3.5 py-2.5 text-sm outline-none focus:ring-2 resize-none"
            @input="onInput"
            @keydown.enter.exact.prevent="onSend"
            @blur="stopTyping"
          />
          <button
            class="grid place-items-center size-10 shrink-0 rounded-xl disabled:opacity-50"
            :style="{ background: accent, color: onAccent }"
            :disabled="!draft.trim()"
            aria-label="Send"
            @click="onSend"
          >
            <UIcon
              name="i-lucide-arrow-up"
              class="size-5"
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
</style>
