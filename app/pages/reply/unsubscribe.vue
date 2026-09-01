<script setup lang="ts">
definePageMeta({ layout: false })
useHead({
  title: 'Email preferences · Perch',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }, { name: 'referrer', content: 'no-referrer' }]
})

const route = useRoute()
const status = ref<'idle' | 'saving' | 'done' | 'error'>('idle')
const message = ref('')

async function unsubscribe() {
  const token = typeof route.query.token === 'string' ? route.query.token : ''
  if (!token) {
    status.value = 'error'
    message.value = 'This unsubscribe link is invalid.'
    return
  }
  status.value = 'saving'
  try {
    await $fetch('/api/visitor-reply/unsubscribe', { method: 'POST', body: { token } })
    history.replaceState({}, '', '/reply/unsubscribe')
    status.value = 'done'
  } catch (error) {
    status.value = 'error'
    message.value = (error as { data?: { message?: string }, statusMessage?: string }).data?.message
      ?? (error as { statusMessage?: string }).statusMessage
      ?? 'Your preference could not be saved.'
  }
}
</script>

<template>
  <main class="grid min-h-screen place-items-center bg-default px-4 py-10 text-default">
    <section class="w-full max-w-md rounded-2xl border border-default bg-elevated p-6 text-center shadow-xl sm:p-8">
      <PerchLogo class="mx-auto" />
      <template v-if="status === 'done'">
        <UIcon
          name="i-lucide-circle-check"
          class="mx-auto mt-8 size-9 text-success"
        />
        <h1 class="mt-4 font-display text-xl font-semibold text-highlighted">
          Email updates stopped
        </h1>
        <p class="mt-2 text-sm leading-6 text-muted">
          You will not receive more chat-reply emails from this workspace. You can opt in again from its chat widget.
        </p>
      </template>
      <template v-else>
        <UIcon
          name="i-lucide-mail-x"
          class="mx-auto mt-8 size-9 text-muted"
        />
        <h1 class="mt-4 font-display text-xl font-semibold text-highlighted">
          Stop reply emails?
        </h1>
        <p class="mt-2 text-sm leading-6 text-muted">
          This only stops visitor chat updates. It does not affect any Perch account or security emails.
        </p>
        <UButton
          class="mt-6 w-full justify-center"
          color="neutral"
          :loading="status === 'saving'"
          @click="unsubscribe"
        >
          Stop email updates
        </UButton>
        <p
          v-if="status === 'error'"
          class="mt-3 text-sm text-error"
          role="alert"
        >
          {{ message }}
        </p>
      </template>
    </section>
  </main>
</template>
