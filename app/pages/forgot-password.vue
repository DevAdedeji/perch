<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Reset your password · Perch' })

const route = useRoute()

const schema = z.object({
  email: z.string().email('Enter a valid email')
})
type Schema = z.output<typeof schema>

const state = reactive({ email: typeof route.query.email === 'string' ? route.query.email : '' })
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
    <div class="mb-7">
      <div class="avatar-primary mb-4 grid size-11 place-items-center rounded-2xl">
        <UIcon
          name="i-lucide-key-round"
          class="size-5.5"
        />
      </div>
      <h1 class="font-display text-3xl font-bold tracking-tight text-highlighted">
        Forgot your password?
      </h1>
      <p class="mt-2 text-sm text-muted">
        We’ll email you a link to choose a new one.
      </p>
    </div>

    <!-- sent -->
    <div
      v-if="sent"
      class="rounded-2xl bg-elevated/40 p-5 ring-1 ring-default"
    >
      <div class="grid size-10 place-items-center rounded-xl bg-green-500/10 ring-1 ring-green-500/25">
        <UIcon
          name="i-lucide-mail-check"
          class="size-5 text-green-600 dark:text-green-500"
        />
      </div>
      <p class="mt-3.5 text-sm font-medium text-highlighted">
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

    <p class="mt-8 text-sm text-muted">
      Remembered it?
      <NuxtLink
        to="/login"
        class="font-medium text-primary-600 hover:underline dark:text-primary-400"
      >Sign in</NuxtLink>
    </p>
  </div>
</template>
