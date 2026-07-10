<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Choose a new password · Perch' })

const route = useRoute()
const token = computed(() => (route.query.token as string) || '')

const schema = z.object({
  password: z.string().min(8, 'At least 8 characters'),
  confirmPassword: z.string().min(1, 'Confirm your password')
}).refine(d => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
})
type Schema = z.output<typeof schema>

const state = reactive({ password: '', confirmPassword: '' })
const loading = ref(false)
const error = ref('')
const done = ref(false)

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  error.value = ''
  try {
    await $fetch('/api/auth/reset-password', {
      method: 'POST',
      body: { token: token.value, password: event.data.password }
    })
    done.value = true
  } catch (e) {
    error.value = getErrorMessage(e, 'Could not reset your password')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="w-full max-w-sm">
    <div class="text-center mb-7">
      <div class="mx-auto mb-4 grid place-items-center size-12 rounded-2xl avatar-amber">
        <UIcon
          name="i-lucide-lock-keyhole"
          class="size-6"
        />
      </div>
      <h1 class="font-display text-2xl font-bold text-highlighted">
        Choose a new password
      </h1>
    </div>

    <div class="rounded-2xl border-glow bg-elevated/40 glass p-6 sm:p-7 shadow-xl shadow-black/10">
      <!-- no token in the URL -->
      <div
        v-if="!token"
        class="text-center py-2"
      >
        <UIcon
          name="i-lucide-link-2-off"
          class="mx-auto size-7 text-dimmed"
        />
        <p class="mt-3 text-sm text-muted">
          This reset link is incomplete. Open the link from your email, or request a new one.
        </p>
        <UButton
          to="/forgot-password"
          color="primary"
          size="lg"
          block
          class="mt-5 font-semibold"
        >
          Request a new link
        </UButton>
      </div>

      <!-- success -->
      <div
        v-else-if="done"
        class="text-center py-2"
      >
        <div class="mx-auto grid place-items-center size-12 rounded-xl bg-green-500/10 ring-1 ring-green-500/25">
          <UIcon
            name="i-lucide-check"
            class="size-6 text-green-600 dark:text-green-500"
          />
        </div>
        <p class="mt-4 text-sm font-medium text-highlighted">
          Password updated
        </p>
        <p class="mt-1.5 text-sm text-muted">
          You can sign in with your new password now.
        </p>
        <UButton
          to="/login"
          color="primary"
          size="lg"
          block
          class="mt-5 font-semibold"
          trailing-icon="i-lucide-arrow-right"
        >
          Sign in
        </UButton>
      </div>

      <!-- form -->
      <UForm
        v-else
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          :title="error"
          icon="i-lucide-triangle-alert"
        />

        <UFormField
          label="New password"
          name="password"
          hint="Min. 8 characters"
        >
          <PasswordInput
            v-model="state.password"
            autocomplete="new-password"
          />
        </UFormField>

        <UFormField
          label="Confirm password"
          name="confirmPassword"
        >
          <PasswordInput
            v-model="state.confirmPassword"
            autocomplete="new-password"
          />
        </UFormField>

        <UButton
          type="submit"
          color="primary"
          size="lg"
          block
          :loading="loading"
          class="font-semibold"
        >
          Reset password
        </UButton>
      </UForm>
    </div>
  </div>
</template>
