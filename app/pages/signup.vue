<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Create your account · Perch' })

const schema = z.object({
  name: z.string().trim().min(1, 'Enter your name'),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
  confirmPassword: z.string().min(1, 'Confirm your password')
}).refine(d => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
})
type Schema = z.output<typeof schema>

const state = reactive({ name: '', email: '', password: '', confirmPassword: '' })
const loading = ref(false)
const error = ref('')

const route = useRoute()
const { refresh } = useAuth()

// carry an invite through signup so we land back on the join page
const redirect = computed(() => (route.query.redirect as string | undefined) || '/onboarding')

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  error.value = ''
  try {
    const { name, email, password } = event.data
    await $fetch('/api/auth/signup', { method: 'POST', body: { name, email, password } })
    await refresh()
    await navigateTo(redirect.value)
  } catch (e) {
    error.value = getErrorMessage(e, 'Could not create your account')
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
          name="i-lucide-bird"
          class="size-6"
        />
      </div>
      <h1 class="font-display text-2xl font-bold text-highlighted">
        Create your account
      </h1>
      <p class="mt-1.5 text-sm text-muted">
        Spin up a workspace in under two minutes.
      </p>
    </div>

    <div class="rounded-2xl border-glow bg-elevated/40 glass p-6 sm:p-7 shadow-xl shadow-black/10">
      <UForm
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
          label="Name"
          name="name"
        >
          <UInput
            v-model="state.name"
            placeholder="Ada Lovelace"
            autocomplete="name"
            size="lg"
            class="w-full"
          />
        </UFormField>

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

        <UFormField
          label="Password"
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
          Create account
        </UButton>
      </UForm>
    </div>

    <p class="mt-6 text-center text-sm text-muted">
      Already have an account?
      <NuxtLink
        to="/login"
        class="font-medium text-amber-600 dark:text-amber-400 hover:underline"
      >Sign in</NuxtLink>
    </p>
  </div>
</template>
