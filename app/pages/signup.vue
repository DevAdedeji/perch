<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { safeAuthRedirect } from '@perch/shared'

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

const route = useRoute()
const { refresh } = useAuth()
const { data: authMethods } = await useFetch<{ google: boolean }>('/api/auth/methods', {
  default: () => ({ google: false })
})

// carry an invite through signup so we land back on the join page
const redirect = computed(() => safeAuthRedirect(route.query.redirect, '/onboarding'))
const error = ref(route.query.oauth_error
  ? 'Google sign-up could not be completed. Please try again.'
  : '')

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
    <div class="mb-7">
      <h1 class="font-display text-3xl font-bold tracking-tight text-highlighted">
        Create your account
      </h1>
      <p class="mt-2 text-sm text-muted">
        Spin up a workspace in under two minutes.
      </p>
    </div>

    <template v-if="authMethods.google">
      <GoogleAuthButton
        label="Sign up with Google"
        source="signup"
        :redirect="redirect"
      />

      <div class="my-5 flex items-center gap-3">
        <span class="h-px flex-1 bg-border" />
        <span class="text-xs text-dimmed">or with email</span>
        <span class="h-px flex-1 bg-border" />
      </div>
    </template>

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

      <p class="text-xs text-dimmed">
        By creating an account you agree to the
        <NuxtLink
          to="/terms"
          class="underline hover:text-muted"
        >Terms</NuxtLink>
        and
        <NuxtLink
          to="/privacy"
          class="underline hover:text-muted"
        >Privacy Policy</NuxtLink>.
      </p>
    </UForm>

    <p class="mt-8 text-sm text-muted">
      Already have an account?
      <NuxtLink
        to="/login"
        class="font-medium text-primary-600 hover:underline dark:text-primary-400"
      >Sign in</NuxtLink>
    </p>
  </div>
</template>
