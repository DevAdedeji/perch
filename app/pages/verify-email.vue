<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Verify your email · Perch' })

const route = useRoute()
const token = computed(() => (route.query.token as string) || '')

const { loggedIn, refresh } = useAuth()
const status = ref<'verifying' | 'done' | 'error'>('verifying')
const error = ref('')
const verifiedEmail = ref('')

onMounted(async () => {
  if (!token.value) {
    status.value = 'error'
    error.value = 'This verification link is incomplete. Open the link from your email.'
    return
  }
  try {
    const res = await $fetch<{ ok: boolean, email: string }>('/api/auth/verify-email', {
      method: 'POST',
      body: { token: token.value }
    })
    verifiedEmail.value = res.email
    status.value = 'done'
    // the session may now carry a stale email — refetch if signed in
    if (loggedIn.value) await refresh()
  } catch (e) {
    status.value = 'error'
    error.value = getErrorMessage(e, 'This link is invalid or has expired — request a new one')
  }
})
</script>

<template>
  <div class="w-full max-w-sm">
    <div class="text-center mb-7">
      <div class="mx-auto mb-4 grid place-items-center size-12 rounded-2xl avatar-amber">
        <UIcon
          name="i-lucide-mail-check"
          class="size-6"
        />
      </div>
      <h1 class="font-display text-2xl font-bold text-highlighted">
        Verify your email
      </h1>
    </div>

    <div class="rounded-2xl border-glow bg-elevated/40 glass p-6 sm:p-7 shadow-xl shadow-black/10">
      <!-- verifying -->
      <div
        v-if="status === 'verifying'"
        class="text-center py-4"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="mx-auto size-7 text-dimmed animate-spin"
        />
        <p class="mt-3 text-sm text-muted">
          Confirming your email address…
        </p>
      </div>

      <!-- success -->
      <div
        v-else-if="status === 'done'"
        class="text-center py-2"
      >
        <div class="mx-auto grid place-items-center size-12 rounded-xl bg-green-500/10 ring-1 ring-green-500/25">
          <UIcon
            name="i-lucide-check"
            class="size-6 text-green-600 dark:text-green-500"
          />
        </div>
        <p class="mt-4 text-sm font-medium text-highlighted">
          Email verified
        </p>
        <p class="mt-1.5 text-sm text-muted">
          <span class="font-medium text-highlighted">{{ verifiedEmail }}</span> is confirmed on your account.
        </p>
        <UButton
          :to="loggedIn ? '/dashboard' : '/login'"
          color="primary"
          size="lg"
          block
          class="mt-5 font-semibold"
          trailing-icon="i-lucide-arrow-right"
        >
          {{ loggedIn ? 'Open the control room' : 'Sign in' }}
        </UButton>
      </div>

      <!-- error -->
      <div
        v-else
        class="text-center py-2"
      >
        <UIcon
          name="i-lucide-link-2-off"
          class="mx-auto size-7 text-dimmed"
        />
        <p class="mt-3 text-sm text-muted">
          {{ error }}
        </p>
        <UButton
          :to="loggedIn ? '/account' : '/login'"
          color="primary"
          size="lg"
          block
          class="mt-5 font-semibold"
        >
          {{ loggedIn ? 'Request a new link' : 'Sign in' }}
        </UButton>
      </div>
    </div>
  </div>
</template>
