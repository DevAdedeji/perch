<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Reset your password · Perch' })

const schema = z.object({
  email: z.string().email('Enter a valid email')
})
type Schema = z.output<typeof schema>

const state = reactive({ email: '' })
const loading = ref(false)
const error = ref('')
const sent = ref(false)

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  error.value = ''
  try {
    await $fetch('/api/auth/forgot-password', { method: 'POST', body: event.data })
    sent.value = true
  } catch (e) {
    error.value = getErrorMessage(e, 'Could not start the reset')
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
          name="i-lucide-key-round"
          class="size-6"
        />
      </div>
      <h1 class="font-display text-2xl font-bold text-highlighted">
        Forgot your password?
      </h1>
      <p class="mt-1.5 text-sm text-muted">
        We’ll email you a link to choose a new one.
      </p>
    </div>

    <div class="rounded-2xl border-glow bg-elevated/40 glass p-6 sm:p-7 shadow-xl shadow-black/10">
      <!-- sent -->
      <div
        v-if="sent"
        class="text-center py-2"
      >
        <div class="mx-auto grid place-items-center size-12 rounded-xl bg-green-500/10 ring-1 ring-green-500/25">
          <UIcon
            name="i-lucide-mail-check"
            class="size-6 text-green-600 dark:text-green-500"
          />
        </div>
        <p class="mt-4 text-sm font-medium text-highlighted">
          Check your inbox
        </p>
        <p class="mt-1.5 text-sm text-muted">
          If an account exists for <span class="font-medium text-highlighted">{{ state.email }}</span>,
          a reset link is on its way. It expires in 30 minutes.
        </p>
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
          label="Email"
          name="email"
        >
          <UInput
            v-model="state.email"
            type="email"
            placeholder="you@company.com"
            autocomplete="email"
            size="lg"
            class="w-full"
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
          Send reset link
        </UButton>
      </UForm>
    </div>

    <p class="mt-6 text-center text-sm text-muted">
      Remembered it?
      <NuxtLink
        to="/login"
        class="font-medium text-amber-600 dark:text-amber-400 hover:underline"
      >Sign in</NuxtLink>
    </p>
  </div>
</template>
