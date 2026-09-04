<script setup lang="ts">
definePageMeta({ layout: false })
useHead({
  title: 'Private support reply · Perch',
  meta: [
    { name: 'robots', content: 'noindex, nofollow' },
    { name: 'referrer', content: 'no-referrer' }
  ]
})

interface ReplyMessage {
  id: string
  sender_type: 'visitor' | 'agent' | 'system'
  content: string
  created_at: string
}

interface ReplySession {
  workspace: { name: string, logo_url: string | null, color: string }
  visitor: { name: string | null }
  conversation: { id: string, status: 'unassigned' | 'open' | 'resolved' }
  messages: ReplyMessage[]
}

const route = useRoute()
const status = ref<'loading' | 'ready' | 'error'>('loading')
const errorMessage = ref('')
const session = ref<ReplySession | null>(null)
const draft = ref('')
const sending = ref(false)
let poll: ReturnType<typeof setInterval> | undefined

async function load() {
  try {
    session.value = await $fetch<ReplySession>('/api/visitor-reply/session')
    status.value = 'ready'
  } catch (error) {
    status.value = 'error'
    errorMessage.value = (error as { data?: { message?: string }, statusMessage?: string }).data?.message
      ?? (error as { statusMessage?: string }).statusMessage
      ?? 'This private return link is no longer available.'
  }
}

async function start() {
  const token = typeof route.query.token === 'string' ? route.query.token : ''
  if (token) {
    try {
      await $fetch('/api/visitor-reply/exchange', { method: 'POST', body: { token } })
      history.replaceState({}, '', '/reply')
    } catch (error) {
      status.value = 'error'
      errorMessage.value = (error as { data?: { message?: string }, statusMessage?: string }).data?.message
        ?? (error as { statusMessage?: string }).statusMessage
        ?? 'This private return link has expired or was already used.'
      return
    }
  }
  await load()
  if (status.value === 'ready') poll = setInterval(load, 5000)
}

async function send() {
  const content = draft.value.trim()
  if (!content || sending.value) return
  sending.value = true
  try {
    const result = await $fetch<{ message: ReplyMessage }>('/api/visitor-reply/messages', {
      method: 'POST',
      body: { content }
    })
    draft.value = ''
    if (session.value && !session.value.messages.some(message => message.id === result.message.id)) {
      session.value.messages.push(result.message)
    }
  } catch (error) {
    errorMessage.value = (error as { data?: { message?: string }, statusMessage?: string }).data?.message
      ?? (error as { statusMessage?: string }).statusMessage
      ?? 'Your message could not be sent. Please try again.'
  } finally {
    sending.value = false
  }
}

onMounted(start)
onBeforeUnmount(() => clearInterval(poll))
</script>

<template>
  <main class="min-h-screen bg-default px-4 py-6 text-default sm:py-10">
    <section class="mx-auto flex min-h-[min(760px,calc(100vh-3rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-default bg-elevated shadow-xl">
      <header class="flex items-center gap-3 border-b border-default px-4 py-4 sm:px-6">
        <span class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-accented font-semibold">
          <img
            v-if="session?.workspace.logo_url"
            :src="session.workspace.logo_url"
            alt=""
            class="size-full object-cover"
          >
          <span v-else>{{ session?.workspace.name?.charAt(0) || 'P' }}</span>
        </span>
        <div class="min-w-0">
          <h1 class="truncate font-display text-base font-semibold text-highlighted">
            {{ session?.workspace.name || 'Private support conversation' }}
          </h1>
          <p class="text-xs text-muted">
            Secure reply powered by Perch
          </p>
        </div>
      </header>

      <div
        v-if="status === 'loading'"
        class="grid flex-1 place-items-center p-8"
        role="status"
      >
        <div class="text-center">
          <UIcon
            name="i-lucide-loader-circle"
            class="mx-auto size-6 animate-spin text-primary"
          />
          <p class="mt-3 text-sm text-muted">
            Opening your private conversation…
          </p>
        </div>
      </div>

      <div
        v-else-if="status === 'error'"
        class="grid flex-1 place-items-center p-8 text-center"
        role="alert"
      >
        <div class="max-w-sm">
          <UIcon
            name="i-lucide-link-2-off"
            class="mx-auto size-8 text-muted"
          />
          <h2 class="mt-4 font-display text-lg font-semibold text-highlighted">
            This link cannot be opened
          </h2>
          <p class="mt-2 text-sm leading-6 text-muted">
            {{ errorMessage }}
          </p>
          <p class="mt-3 text-xs text-dimmed">
            Return to the website where you started the chat to continue.
          </p>
        </div>
      </div>

      <template v-else-if="session">
        <div
          class="flex-1 space-y-3 overflow-y-auto bg-default/40 px-4 py-5 sm:px-6"
          aria-live="polite"
        >
          <div
            v-for="message in session.messages"
            :key="message.id"
            class="flex"
            :class="message.sender_type === 'visitor' ? 'justify-end' : 'justify-start'"
          >
            <div
              class="max-w-[86%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 sm:max-w-[72%]"
              :class="message.sender_type === 'visitor' ? 'bg-primary text-inverted' : 'border border-default bg-elevated text-default'"
            >
              <MessageContent :content="message.content" />
            </div>
          </div>
        </div>

        <form
          class="border-t border-default p-3 sm:p-4"
          @submit.prevent="send"
        >
          <label
            for="secure-reply"
            class="sr-only"
          >Write a reply</label>
          <textarea
            id="secure-reply"
            v-model="draft"
            rows="3"
            maxlength="5000"
            placeholder="Write a reply…"
            class="min-h-24 w-full resize-none rounded-xl border border-default bg-default px-3.5 py-3 text-base outline-none focus:ring-2 focus:ring-primary"
            @keydown.meta.enter.prevent="send"
            @keydown.ctrl.enter.prevent="send"
          />
          <div class="mt-3 flex items-center justify-between gap-3">
            <p class="text-xs text-dimmed">
              Only public chat messages are shown here.
            </p>
            <UButton
              type="submit"
              icon="i-lucide-send"
              :loading="sending"
              :disabled="!draft.trim()"
            >
              Send reply
            </UButton>
          </div>
          <p
            v-if="errorMessage"
            class="mt-2 text-sm text-error"
            role="alert"
          >
            {{ errorMessage }}
          </p>
        </form>
      </template>
    </section>
  </main>
</template>
