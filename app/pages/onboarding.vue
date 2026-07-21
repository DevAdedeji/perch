<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Set up your workspace · Perch' })

const toast = useToast()
const { refresh } = useAuth()
const origin = useRequestURL().origin

const steps = ['Workspace', 'Invite team', 'You’re live'] as const
const step = ref(0)

/* step 1: workspace */
const swatches = ['#8b5cf6', '#6366f1', '#f43f5e', '#ec4899', '#f59e0b', '#f97316', '#0ea5e9', '#10b981']
const form = reactive({ name: '', color: '#8b5cf6' })
const creating = ref(false)
const createError = ref('')

const created = ref<{ id: string, siteId: string, name: string } | null>(null)

function comingSoonLogo() {
  toast.add({ title: 'Logo upload is coming soon', description: 'You’ll be able to add one from Settings.', icon: 'i-lucide-image', color: 'neutral' })
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
// closing tag split so it doesn't terminate this SFC <script> block
const closeScript = '</' + 'script>'
const snippet = computed(() =>
  `<script src="${origin}/widget.js" data-site-id="${created.value?.siteId ?? ''}" async>${closeScript}`
)

async function copy(text: string, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: label, icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Copy failed', color: 'error' })
  }
}

async function finish() {
  await navigateTo('/dashboard')
}
</script>

<template>
  <div class="w-full max-w-xl">
    <!-- stepper -->
    <ol class="flex items-center justify-center gap-2 mb-8">
      <li
        v-for="(label, i) in steps"
        :key="label"
        class="flex items-center gap-2"
      >
        <span
          class="grid place-items-center size-7 rounded-full text-xs font-semibold ring-1 transition-colors"
          :class="i <= step ? 'bg-inverted text-inverted ring-inverted' : 'bg-elevated text-dimmed ring-default'"
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
          :class="i < step ? 'bg-inverted' : 'bg-(--ui-border-accented)'"
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
          />
          <div class="flex-1">
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted ring-1 ring-default hover:text-highlighted hover:bg-elevated/60 transition-colors"
              @click="comingSoonLogo"
            >
              <UIcon
                name="i-lucide-upload"
                class="size-4"
              />
              Add logo
            </button>
            <p class="mt-1.5 text-xs text-dimmed">
              Optional — a lettermark is used until you add one.
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
          :loading="creating"
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

        <div class="mt-6 text-left rounded-xl bg-default ring-1 ring-default overflow-hidden">
          <div class="flex items-center gap-2 px-4 py-2 border-b border-default bg-elevated/50">
            <UIcon
              name="i-lucide-code"
              class="size-4 text-dimmed"
            />
            <span class="text-xs font-mono text-dimmed">embed snippet</span>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-copy"
              class="ml-auto"
              @click="copy(snippet, 'Snippet copied')"
            >
              Copy
            </UButton>
          </div>
          <pre class="p-4 text-xs sm:text-sm font-mono text-highlighted overflow-x-auto whitespace-pre-wrap break-all">{{ snippet }}</pre>
        </div>

        <UButton
          color="neutral"
          size="lg"
          block
          class="mt-8 font-medium"
          trailing-icon="i-lucide-arrow-right"
          @click="finish"
        >
          Go to your Control Room
        </UButton>
      </div>
    </div>
  </div>
</template>
