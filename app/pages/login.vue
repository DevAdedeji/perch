<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { safeAuthRedirect } from '@perch/shared'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Sign in · Perch' })

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password')
})
type Schema = z.output<typeof schema>

const state = reactive({ email: '', password: '' })
const loading = ref(false)

const route = useRoute()
const { refresh, hasWorkspace } = useAuth()
const { data: authMethods } = await useFetch<{ google: boolean }>('/api/auth/methods', {
  default: () => ({ google: false })
})
const redirect = computed(() => safeAuthRedirect(route.query.redirect, '/dashboard'))
const error = ref(route.query.oauth_error
  ? 'Google sign-in could not be completed. Please try again.'
  : '')

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  error.value = ''
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: event.data })
    await refresh()
    await navigateTo(route.query.redirect
      ? redirect.value
      : hasWorkspace.value ? '/dashboard' : '/onboarding')
  } catch (e) {
    error.value = getErrorMessage(e, 'Could not sign in')
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
        Welcome back
      </h1>
      <p class="mt-1.5 text-sm text-muted">
        Sign in to your Control Room.
      </p>
    </div>

    <div class="rounded-2xl border-glow bg-elevated/40 glass p-6 sm:p-7 shadow-xl shadow-black/10">
      <template v-if="authMethods.google">
        <GoogleAuthButton :redirect="redirect" />

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
        >
          <PasswordInput
            v-model="state.password"
            autocomplete="current-password"
          />
        </UFormField>

        <div class="flex justify-end -mt-1">
          <NuxtLink
            to="/forgot-password"
            class="text-xs font-medium text-muted hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
          >
            Forgot password?
          </NuxtLink>
        </div>

        <UButton
          type="submit"
          color="primary"
          size="lg"
          block
          :loading="loading"
          class="font-semibold"
        >
          Sign in
        </UButton>
      </UForm>
    </div>

    <p class="mt-6 text-center text-sm text-muted">
      New to Perch?
      <NuxtLink
        to="/signup"
        class="font-medium text-amber-600 dark:text-amber-400 hover:underline"
      >Create an account</NuxtLink>
    </p>
  </div>
</template>
