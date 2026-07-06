<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Join a workspace · Perch' })

const route = useRoute()
const token = route.params.token as string
const { loggedIn, user, refresh } = useAuth()

interface InviteInfo {
  email: string
  role: 'admin' | 'agent'
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  workspace: { name: string, logoUrl: string | null, widgetPrimaryColor: string } | null
}

const { data: invite, error: fetchError } = await useFetch<InviteInfo>(`/api/invites/${token}`)

const accepting = ref(false)
const acceptError = ref('')

const emailMismatch = computed(() =>
  loggedIn.value && invite.value && user.value
    ? invite.value.email.toLowerCase() !== user.value.email.toLowerCase()
    : false
)

async function accept() {
  accepting.value = true
  acceptError.value = ''
  try {
    await $fetch(`/api/invites/${token}/accept`, { method: 'POST' })
    await refresh()
    await navigateTo('/dashboard')
  } catch (e) {
    acceptError.value = getErrorMessage(e, 'Could not accept invite')
  } finally {
    accepting.value = false
  }
}

const joinRedirect = `/join/${token}`
</script>

<template>
  <div class="w-full max-w-sm text-center">
    <!-- invalid / expired -->
    <div
      v-if="fetchError || !invite || invite.status !== 'pending'"
      class="rounded-2xl border-glow bg-elevated/40 glass p-8 shadow-xl shadow-black/10"
    >
      <div class="mx-auto grid place-items-center size-12 rounded-xl bg-elevated ring-1 ring-default">
        <UIcon
          name="i-lucide-link-2-off"
          class="size-6 text-dimmed"
        />
      </div>
      <h1 class="mt-4 font-display text-xl font-bold text-highlighted">
        Invite unavailable
      </h1>
      <p class="mt-1.5 text-sm text-muted">
        {{ invite?.status === 'accepted' ? 'This invite has already been used.'
          : invite?.status === 'expired' ? 'This invite has expired.'
            : 'This invite link is invalid or has been revoked.' }}
      </p>
      <UButton
        to="/login"
        color="neutral"
        variant="subtle"
        size="lg"
        block
        class="mt-6"
      >
        Go to sign in
      </UButton>
    </div>

    <!-- valid invite -->
    <div
      v-else
      class="rounded-2xl border-glow bg-elevated/40 glass p-8 shadow-xl shadow-black/10"
    >
      <WorkspaceAvatar
        :name="invite.workspace?.name"
        :color="invite.workspace?.widgetPrimaryColor ?? '#f59e0b'"
        :logo-url="invite.workspace?.logoUrl"
        :size="64"
        class="mx-auto"
      />
      <h1 class="mt-5 font-display text-xl font-bold text-highlighted">
        Join {{ invite.workspace?.name ?? 'the workspace' }}
      </h1>
      <p class="mt-1.5 text-sm text-muted">
        You’ve been invited as
        <span class="font-medium text-highlighted">{{ invite.role }}</span>
        ({{ invite.email }}).
      </p>

      <UAlert
        v-if="emailMismatch"
        color="warning"
        variant="subtle"
        class="mt-5 text-left"
        icon="i-lucide-triangle-alert"
        :title="`Signed in as ${user?.email}`"
        :description="`This invite is for ${invite.email}. Sign out and use that email to accept.`"
      />
      <UAlert
        v-if="acceptError"
        color="error"
        variant="subtle"
        :title="acceptError"
        icon="i-lucide-triangle-alert"
        class="mt-5"
      />

      <!-- logged in → accept -->
      <UButton
        v-if="loggedIn"
        color="primary"
        size="lg"
        block
        class="mt-6 font-medium"
        :loading="accepting"
        :disabled="emailMismatch"
        trailing-icon="i-lucide-arrow-right"
        @click="accept"
      >
        Accept & join
      </UButton>

      <!-- logged out → auth first -->
      <div
        v-else
        class="mt-6 space-y-2.5"
      >
        <UButton
          :to="`/signup?redirect=${encodeURIComponent(joinRedirect)}`"
          color="primary"
          size="lg"
          block
          class="font-medium"
        >
          Create account to join
        </UButton>
        <UButton
          :to="`/login?redirect=${encodeURIComponent(joinRedirect)}`"
          color="neutral"
          variant="subtle"
          size="lg"
          block
        >
          I already have an account
        </UButton>
      </div>
    </div>
  </div>
</template>
