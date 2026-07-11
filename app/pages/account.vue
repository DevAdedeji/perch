<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Account · Perch' })

const { user, refresh } = useAuth()
const toast = useToast()

/* ── profile name ── */
const name = ref(user.value?.name ?? '')
watch(user, (u) => {
  if (u && !name.value) name.value = u.name
})
const savingName = ref(false)

async function saveName() {
  const next = name.value.trim()
  if (!next || next === user.value?.name || savingName.value) return
  savingName.value = true
  try {
    await $fetch('/api/auth/profile', { method: 'PATCH', body: { name: next } })
    await refresh()
    toast.add({ title: 'Name updated', icon: 'i-lucide-check', color: 'success' })
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not update your name'), color: 'error' })
  } finally {
    savingName.value = false
  }
}

/* ── email verification / change ── */
const resending = ref(false)
async function resendVerification() {
  if (resending.value) return
  resending.value = true
  try {
    await $fetch('/api/auth/send-verification', { method: 'POST' })
    toast.add({ title: 'Verification email sent', description: 'Check your inbox for the link.', icon: 'i-lucide-mail-check', color: 'success' })
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not send the email'), color: 'error' })
  } finally {
    resending.value = false
  }
}

const emailForm = reactive({ newEmail: '', password: '' })
const changingEmail = ref(false)
const emailChangePending = ref(false)

async function changeEmail() {
  if (!emailForm.newEmail || !emailForm.password || changingEmail.value) return
  changingEmail.value = true
  try {
    await $fetch('/api/auth/change-email', {
      method: 'POST',
      body: { new_email: emailForm.newEmail, password: emailForm.password }
    })
    emailChangePending.value = true
    toast.add({
      title: 'Confirmation sent',
      description: `We emailed a link to ${emailForm.newEmail.trim()}. Your address changes once it's clicked.`,
      icon: 'i-lucide-mail-check',
      color: 'success'
    })
    emailForm.newEmail = ''
    emailForm.password = ''
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not start the email change'), color: 'error' })
  } finally {
    changingEmail.value = false
  }
}

/* ── password change ── */
const passwordForm = reactive({ current: '', next: '', confirm: '' })
const changingPassword = ref(false)

async function changePassword() {
  if (changingPassword.value) return
  if (passwordForm.next.length < 8) {
    toast.add({ title: 'New password must be at least 8 characters', color: 'error' })
    return
  }
  if (passwordForm.next !== passwordForm.confirm) {
    toast.add({ title: 'New passwords do not match', color: 'error' })
    return
  }
  changingPassword.value = true
  try {
    await $fetch('/api/auth/change-password', {
      method: 'POST',
      body: { current_password: passwordForm.current, new_password: passwordForm.next }
    })
    passwordForm.current = ''
    passwordForm.next = ''
    passwordForm.confirm = ''
    toast.add({ title: 'Password updated', icon: 'i-lucide-check', color: 'success' })
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not change your password'), color: 'error' })
  } finally {
    changingPassword.value = false
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-2xl mx-auto p-5 sm:p-8 space-y-8">
      <h1 class="font-display text-2xl font-bold text-highlighted">
        Account
      </h1>

      <!-- Profile -->
      <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
        <h2 class="font-display font-semibold text-highlighted">
          Profile
        </h2>
        <p class="text-sm text-muted mt-0.5">
          How your name appears to teammates and visitors.
        </p>

        <UFormField
          label="Your name"
          class="mt-5"
        >
          <div class="flex gap-2">
            <UInput
              v-model="name"
              size="lg"
              class="flex-1"
              @keyup.enter="saveName"
            />
            <UButton
              color="neutral"
              size="lg"
              :loading="savingName"
              :disabled="!name.trim() || name.trim() === user?.name"
              @click="saveName"
            >
              Save
            </UButton>
          </div>
        </UFormField>
      </section>

      <!-- Email -->
      <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="font-display font-semibold text-highlighted">
              Email
            </h2>
            <p class="text-sm text-muted mt-0.5">
              {{ user?.email }}
            </p>
          </div>
          <UBadge
            :color="user?.emailVerified ? 'success' : 'warning'"
            variant="subtle"
            :icon="user?.emailVerified ? 'i-lucide-badge-check' : 'i-lucide-mail-warning'"
          >
            {{ user?.emailVerified ? 'Verified' : 'Unverified' }}
          </UBadge>
        </div>

        <div
          v-if="!user?.emailVerified"
          class="mt-4 flex items-center justify-between gap-3 rounded-xl bg-amber-500/10 ring-1 ring-amber-500/25 px-4 py-3"
        >
          <p class="text-sm text-amber-700 dark:text-amber-400">
            Confirm your address to secure your account.
          </p>
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            :loading="resending"
            @click="resendVerification"
          >
            Resend email
          </UButton>
        </div>

        <USeparator class="my-5" />

        <p class="text-sm font-medium text-highlighted">
          Change email
        </p>
        <p class="text-xs text-muted mt-0.5">
          We'll send a confirmation link to the new address — nothing changes until it's clicked.
        </p>
        <UAlert
          v-if="emailChangePending"
          class="mt-3"
          color="info"
          variant="subtle"
          icon="i-lucide-mail-check"
          title="Confirmation pending"
          description="Open the link we sent to the new address to complete the change."
        />
        <div class="mt-4 space-y-4">
          <UFormField label="New email">
            <UInput
              v-model="emailForm.newEmail"
              type="email"
              size="lg"
              class="w-full"
              autocomplete="email"
            />
          </UFormField>
          <UFormField label="Current password">
            <PasswordInput
              v-model="emailForm.password"
              autocomplete="current-password"
            />
          </UFormField>
          <UButton
            color="neutral"
            size="lg"
            :loading="changingEmail"
            :disabled="!emailForm.newEmail || !emailForm.password"
            @click="changeEmail"
          >
            Send confirmation
          </UButton>
        </div>
      </section>

      <!-- Password -->
      <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
        <h2 class="font-display font-semibold text-highlighted">
          Password
        </h2>
        <p class="text-sm text-muted mt-0.5">
          Changing your password also invalidates any outstanding reset links.
        </p>

        <div class="mt-5 space-y-4">
          <UFormField label="Current password">
            <PasswordInput
              v-model="passwordForm.current"
              autocomplete="current-password"
            />
          </UFormField>
          <UFormField
            label="New password"
            hint="Min. 8 characters"
          >
            <PasswordInput
              v-model="passwordForm.next"
              autocomplete="new-password"
            />
          </UFormField>
          <UFormField label="Confirm new password">
            <PasswordInput
              v-model="passwordForm.confirm"
              autocomplete="new-password"
            />
          </UFormField>
          <UButton
            color="neutral"
            size="lg"
            :loading="changingPassword"
            :disabled="!passwordForm.current || !passwordForm.next || !passwordForm.confirm"
            @click="changePassword"
          >
            Update password
          </UButton>
        </div>
      </section>
    </div>
  </div>
</template>
