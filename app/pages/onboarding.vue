<script setup lang="ts">
import { validateImageAttachment } from '@perch/shared'

definePageMeta({ layout: 'onboarding' })
useHead({ title: 'Set up your workspace · Perch' })

const toast = useToast()
const { refresh } = useAuth()
const { copy } = useCopyToClipboard()
const origin = useRequestURL().origin

const steps = ['Workspace', 'Invite team', 'You’re live'] as const
const step = ref(0)

/* step 1: workspace */
const swatches = ['#8b5cf6', '#6366f1', '#f43f5e', '#ec4899', '#f59e0b', '#f97316', '#0ea5e9', '#10b981']
const form = reactive({ name: '', color: '#8b5cf6' })
const creating = ref(false)
const createError = ref('')
const logoError = ref('')
const logoFile = ref<File | null>(null)
const logoPreview = ref<string | null>(null)
const logoEl = ref<HTMLInputElement | null>(null)
const { uploading: logoUploading, uploadImage } = useImageUpload()

const created = ref<{ id: string, siteId: string, name: string } | null>(null)

function pickLogo() {
  logoEl.value?.click()
}

function clearLogo() {
  if (logoPreview.value) URL.revokeObjectURL(logoPreview.value)
  logoFile.value = null
  logoPreview.value = null
  logoError.value = ''
}

function onLogoPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  const error = validateImageAttachment(file)
  if (error) {
    logoError.value = error
    return
  }

  clearLogo()
  logoFile.value = file
  logoPreview.value = URL.createObjectURL(file)
}

onBeforeUnmount(() => {
  if (logoPreview.value) URL.revokeObjectURL(logoPreview.value)
})

async function saveSelectedLogo(workspaceId: string) {
  if (!logoFile.value) return
  const uploaded = await uploadImage(logoFile.value)
  await $fetch(`/api/workspaces/${workspaceId}`, {
    method: 'PATCH',
    body: { logoUrl: uploaded.url }
  })
}

async function createWorkspace() {
  if (!form.name.trim()) {
    createError.value = 'Give your workspace a name'
    return
  }
  creating.value = true
  createError.value = ''
  try {
    const res = await $fetch<{ workspace: { id: string, siteId: string, name: string } }>('/api/workspaces', {
      method: 'POST',
      body: { name: form.name.trim(), widgetPrimaryColor: form.color }
    })
    created.value = res.workspace
    await refresh() // membership now exists → unlocks /dashboard

    try {
      await saveSelectedLogo(res.workspace.id)
    } catch (error) {
      toast.add({
        title: 'Workspace created without the logo',
        description: `${getErrorMessage(error, 'The logo could not be uploaded')} You can add it later in Settings.`,
        icon: 'i-lucide-image-off',
        color: 'warning'
      })
    }
    step.value = 1
  } catch (e) {
    createError.value = getErrorMessage(e, 'Could not create workspace')
  } finally {
    creating.value = false
  }
}

/* step 2: invites */
const roleItems = ['agent', 'admin']
const inviteRows = reactive<Array<{ email: string, role: 'agent' | 'admin' }>>([{ email: '', role: 'agent' }])
const sending = ref(false)
const inviteError = ref('')
const sentInvites = ref<Array<{ email: string, url: string }>>([])

function addRow() {
  inviteRows.push({ email: '', role: 'agent' })
}
function removeRow(i: number) {
  inviteRows.splice(i, 1)
  if (inviteRows.length === 0) addRow()
}

async function sendInvites() {
  const invites = inviteRows.filter(r => r.email.trim()).map(r => ({ email: r.email.trim(), role: r.role }))
  if (invites.length === 0) {
    step.value = 2
    return
  }
  sending.value = true
  inviteError.value = ''
  try {
    const res = await $fetch<{ invites: Array<{ email: string, url: string }> }>(`/api/workspaces/${created.value!.id}/invites`, {
      method: 'POST',
      body: { invites }
    })
    sentInvites.value = res.invites
  } catch (e) {
    inviteError.value = getErrorMessage(e, 'Could not send invites')
  } finally {
    sending.value = false
  }
}

/* step 3: embed */
const snippet = computed(() => created.value ? buildEmbedSnippet(origin, created.value.siteId) : '')

async function finish() {
  await navigateTo('/installation')
}
</script>

<template>
  <div class="w-full max-w-xl">
    <!-- stepper -->
    <ol class="flex items-center justify-center gap-2 mb-12">
      <li
        v-for="(label, i) in steps"
        :key="label"
        class="flex items-center gap-2"
      >
        <span
          class="grid place-items-center size-7 rounded-full text-xs font-semibold ring-1 transition-colors"
          :class="i < step ? 'bg-primary-500 text-slate-900 ring-primary-500'
            : i === step ? 'bg-inverted text-inverted ring-inverted'
              : 'bg-elevated text-dimmed ring-default'"
        >
          <UIcon
            v-if="i < step"
            name="i-lucide-check"
            class="size-4"
          />
          <template v-else>{{ i + 1 }}</template>
        </span>
        <span
          class="hidden sm:block text-sm"
          :class="i <= step ? 'text-highlighted font-medium' : 'text-dimmed'"
        >{{ label }}</span>
        <span
          v-if="i < steps.length - 1"
          class="w-6 sm:w-10 h-px"
          :class="i < step ? 'bg-primary-500' : 'bg-(--ui-border-accented)'"
        />
      </li>
    </ol>

    <div class="rounded-2xl border-glow bg-elevated/40 glass p-6 sm:p-8 shadow-xl shadow-black/10">
      <!-- STEP 1 -->
      <div v-if="step === 0">
        <h1 class="font-display text-2xl font-bold text-highlighted">
          Create your workspace
        </h1>
        <p class="mt-1.5 text-sm text-muted">
          This is your business inside Perch. You can change it later.
        </p>

        <div class="mt-6 flex items-center gap-4">
          <WorkspaceAvatar
            :name="form.name"
            :color="form.color"
            :size="64"
            :logo-url="logoPreview"
          />
          <div class="flex-1">
            <input
              ref="logoEl"
              type="file"
              accept="image/*"
              class="sr-only"
              @change="onLogoPicked"
            >
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted ring-1 ring-default hover:text-highlighted hover:bg-elevated/60 transition-colors"
              @click="pickLogo"
            >
              <UIcon
                name="i-lucide-upload"
                class="size-4"
              />
              {{ logoFile ? 'Change logo' : 'Add logo' }}
            </button>
            <button
              v-if="logoFile"
              type="button"
              class="mt-2 text-xs font-medium text-muted hover:text-highlighted"
              @click="clearLogo"
            >
              Remove selected logo
            </button>
            <p class="mt-1.5 text-xs text-dimmed">
              Optional — JPG, PNG, GIF or WebP under 1 MB. A lettermark is used otherwise.
            </p>
            <p
              v-if="logoError"
              class="mt-1.5 text-xs text-error"
              role="alert"
            >
              {{ logoError }}
            </p>
          </div>
        </div>

        <div class="mt-6 space-y-5">
          <UFormField
            label="Workspace name"
            :error="createError"
          >
            <UInput
              v-model="form.name"
              placeholder="Acme Support"
              size="lg"
              class="w-full"
              @keyup.enter="createWorkspace"
            />
          </UFormField>

          <div>
            <label class="block text-sm font-medium text-highlighted mb-2">Widget color</label>
            <p class="text-xs text-muted mb-3">
              The accent your visitors see in the chat widget.
            </p>
            <div class="flex items-center gap-2.5 flex-wrap">
              <button
                v-for="c in swatches"
                :key="c"
                type="button"
                class="size-8 rounded-full ring-2 ring-offset-2 ring-offset-(--ui-bg-elevated) transition-transform hover:scale-110"
                :class="form.color === c ? 'ring-highlighted' : 'ring-transparent'"
                :style="{ background: c }"
                :aria-label="c"
                @click="form.color = c"
              />
              <label
                class="size-8 rounded-full grid place-items-center ring-1 ring-default cursor-pointer hover:bg-elevated/60"
                title="Custom color"
              >
                <UIcon
                  name="i-lucide-pipette"
                  class="size-4 text-muted"
                />
                <input
                  v-model="form.color"
                  type="color"
                  class="sr-only"
                >
              </label>
            </div>
          </div>
        </div>

        <UButton
          color="neutral"
          size="lg"
          block
          class="mt-8 font-medium"
          :loading="creating || logoUploading"
          :disabled="creating || logoUploading"
          trailing-icon="i-lucide-arrow-right"
          @click="createWorkspace"
        >
          Continue
        </UButton>
      </div>

      <!-- STEP 2 -->
      <div v-else-if="step === 1">
        <h1 class="font-display text-2xl font-bold text-highlighted">
          Invite your team
        </h1>
        <p class="mt-1.5 text-sm text-muted">
          Add teammates as agents or admins. You can skip and do this later.
        </p>

        <template v-if="sentInvites.length === 0">
          <div class="mt-6 space-y-2.5">
            <div
              v-for="(row, i) in inviteRows"
              :key="i"
              class="flex items-center gap-2"
            >
              <UInput
                v-model="row.email"
                type="email"
                placeholder="teammate@company.com"
                size="lg"
                class="flex-1"
              />
              <USelect
                v-model="row.role"
                :items="roleItems"
                size="lg"
                class="w-28"
              />
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                square
                size="lg"
                aria-label="Remove"
                @click="removeRow(i)"
              />
            </div>
          </div>

          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-plus"
            size="sm"
            class="mt-3"
            @click="addRow"
          >
            Add another
          </UButton>

          <UAlert
            v-if="inviteError"
            color="error"
            variant="subtle"
            :title="inviteError"
            icon="i-lucide-triangle-alert"
            class="mt-4"
          />

          <div class="mt-8 flex items-center gap-3">
            <UButton
              color="neutral"
              variant="subtle"
              size="lg"
              class="flex-1"
              @click="step = 2"
            >
              Skip for now
            </UButton>
            <UButton
              color="neutral"
              size="lg"
              class="flex-1 font-medium"
              :loading="sending"
              @click="sendInvites"
            >
              Send invites
            </UButton>
          </div>
        </template>

        <template v-else>
          <div class="mt-6 space-y-2.5">
            <p class="text-sm text-muted">
              Share these links — they’ll join {{ created?.name }} when they open them.
            </p>
            <div
              v-for="inv in sentInvites"
              :key="inv.url"
              class="flex items-center gap-2 rounded-lg bg-default ring-1 ring-default px-3 py-2.5"
            >
              <UIcon
                name="i-lucide-link"
                class="size-4 text-highlighted shrink-0"
              />
              <span class="text-sm text-highlighted truncate">{{ inv.email }}</span>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-copy"
                class="ml-auto shrink-0"
                @click="copy(inv.url, 'Invite link copied')"
              >
                Copy link
              </UButton>
            </div>
          </div>
          <UButton
            color="neutral"
            size="lg"
            block
            class="mt-8 font-medium"
            trailing-icon="i-lucide-arrow-right"
            @click="step = 2"
          >
            Continue
          </UButton>
        </template>
      </div>

      <!-- STEP 3 -->
      <div
        v-else
        class="text-center"
      >
        <div class="mx-auto grid place-items-center size-14 rounded-2xl bg-inverted/15 ring-1 ring-inverted/25">
          <UIcon
            name="i-lucide-party-popper"
            class="size-7 text-highlighted"
          />
        </div>
        <h1 class="mt-5 font-display text-2xl font-bold text-highlighted">
          You’re live!
        </h1>
        <p class="mt-1.5 text-sm text-muted">
          Paste this snippet before <code class="font-mono text-highlighted">&lt;/body&gt;</code> on your site to start receiving chats.
        </p>

        <EmbedSnippetCard
          class="mt-6 text-left"
          :snippet="snippet"
        />

        <UButton
          color="neutral"
          size="lg"
          block
          class="mt-8 font-medium"
          trailing-icon="i-lucide-arrow-right"
          @click="finish"
        >
          Finish installation
        </UButton>
      </div>
    </div>
  </div>
</template>
