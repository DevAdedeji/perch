<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Settings · Perch' })

interface WorkspaceDetail {
  id: string
  name: string
  siteId: string
  widgetPrimaryColor: string
  prechatFormEnabled: boolean
  role: 'admin' | 'agent'
}

const { currentWorkspace } = useAuth()
const toast = useToast()
const origin = useRequestURL().origin

const wid = computed(() => currentWorkspace.value?.workspaceId ?? null)
const workspace = ref<WorkspaceDetail | null>(null)
const loading = ref(true)
const isAdmin = computed(() => workspace.value?.role === 'admin')

const name = ref('')
const swatches = ['#8b5cf6', '#6366f1', '#f43f5e', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#0f172a']

// closing tag split so it doesn't terminate this SFC <script> block
const closeScript = '</' + 'script>'
const snippet = computed(() =>
  `<script src="${origin}/widget.js" data-site-id="${workspace.value?.siteId ?? ''}" async>${closeScript}`
)

async function load() {
  if (!wid.value) return
  loading.value = true
  try {
    const w = await $fetch<WorkspaceDetail>(`/api/workspaces/${wid.value}`)
    workspace.value = w
    name.value = w.name
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(wid, load)

async function patchWorkspace(body: Record<string, unknown>, okMsg?: string) {
  const res = await $fetch<{ workspace: WorkspaceDetail }>(`/api/workspaces/${wid.value}`, { method: 'PATCH', body })
  if (workspace.value) Object.assign(workspace.value, res.workspace)
  if (okMsg) toast.add({ title: okMsg, icon: 'i-lucide-check', color: 'success' })
}

async function saveName() {
  const next = name.value.trim()
  if (!next || next === workspace.value?.name) return
  try {
    await patchWorkspace({ name: next }, 'Workspace name saved')
  } catch {
    toast.add({ title: 'Could not save', color: 'error' })
  }
}
async function togglePrechat(value: boolean) {
  try {
    await patchWorkspace({ prechatFormEnabled: value })
  } catch {
    toast.add({ title: 'Could not update', color: 'error' })
  }
}
async function setColor(color: string) {
  try {
    await patchWorkspace({ widgetPrimaryColor: color })
  } catch {
    toast.add({ title: 'Could not update', color: 'error' })
  }
}

async function copy(text: string, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: label, icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Copy failed', color: 'error' })
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-2xl mx-auto p-5 sm:p-8 space-y-8">
      <h1 class="font-display text-2xl font-bold text-highlighted">
        Settings
      </h1>

      <div
        v-if="loading"
        class="space-y-4"
      >
        <USkeleton
          v-for="n in 2"
          :key="n"
          class="h-40 w-full rounded-2xl"
        />
      </div>

      <template v-else>
        <!-- General -->
        <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
          <h2 class="font-display font-semibold text-highlighted">
            General
          </h2>
          <p class="text-sm text-muted mt-0.5">
            Your workspace basics.
          </p>

          <div class="mt-5 space-y-5">
            <UFormField label="Workspace name">
              <div class="flex gap-2">
                <UInput
                  v-model="name"
                  :disabled="!isAdmin"
                  size="lg"
                  class="flex-1"
                  @keyup.enter="saveName"
                />
                <UButton
                  v-if="isAdmin"
                  color="neutral"
                  size="lg"
                  :disabled="name.trim() === workspace?.name"
                  @click="saveName"
                >
                  Save
                </UButton>
              </div>
            </UFormField>

            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="text-sm font-medium text-highlighted">
                  Pre-chat form
                </p>
                <p class="text-xs text-muted">
                  Ask visitors for name & email before they chat.
                </p>
              </div>
              <USwitch
                :model-value="workspace?.prechatFormEnabled"
                :disabled="!isAdmin"
                @update:model-value="togglePrechat"
              />
            </div>

            <div>
              <p class="text-sm font-medium text-highlighted">
                Widget color
              </p>
              <p class="text-xs text-muted mb-3">
                The accent your visitors see in the chat widget.
              </p>
              <div class="flex items-center gap-2.5 flex-wrap">
                <button
                  v-for="c in swatches"
                  :key="c"
                  type="button"
                  :disabled="!isAdmin"
                  class="size-8 rounded-full ring-2 ring-offset-2 ring-offset-(--ui-bg) transition-transform hover:scale-110 disabled:opacity-60"
                  :class="workspace?.widgetPrimaryColor === c ? 'ring-highlighted' : 'ring-transparent'"
                  :style="{ background: c }"
                  :aria-label="c"
                  @click="setColor(c)"
                />
              </div>
            </div>
          </div>
        </section>

        <!-- Embed -->
        <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
          <h2 class="font-display font-semibold text-highlighted">
            Install the widget
          </h2>
          <p class="text-sm text-muted mt-0.5">
            Paste this before <code class="font-mono text-xs">&lt;/body&gt;</code> on your site.
          </p>
          <div class="mt-4 rounded-xl bg-default ring-1 ring-default overflow-hidden">
            <div class="flex items-center gap-2 px-4 py-2 border-b border-default bg-elevated/50">
              <UIcon
                name="i-lucide-code"
                class="size-4 text-dimmed"
              />
              <span class="text-xs font-mono text-dimmed">embed snippet</span>
              <UButton
                class="ml-auto"
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-copy"
                @click="copy(snippet, 'Snippet copied')"
              >
                Copy
              </UButton>
            </div>
            <pre class="p-4 text-xs font-mono text-highlighted overflow-x-auto whitespace-pre-wrap break-all">{{ snippet }}</pre>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
