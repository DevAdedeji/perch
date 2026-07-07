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
interface Member {
  id: string
  userId: string
  name: string
  email: string
  role: 'admin' | 'agent'
  presence: 'online' | 'away' | 'offline'
}

const { currentWorkspace, user } = useAuth()
const toast = useToast()
const origin = useRequestURL().origin

const wid = computed(() => currentWorkspace.value?.workspaceId ?? null)
const workspace = ref<WorkspaceDetail | null>(null)
const members = ref<Member[]>([])
const loading = ref(true)
const isAdmin = computed(() => workspace.value?.role === 'admin')

const name = ref('')
const swatches = ['#8b5cf6', '#6366f1', '#f43f5e', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#0f172a']

const inviteEmail = ref('')
const inviteRole = ref<'agent' | 'admin'>('agent')
const inviting = ref(false)
const inviteLink = ref('')

// closing tag split so it doesn't terminate this SFC <script> block
const closeScript = '</' + 'script>'
const snippet = computed(() =>
  `<script src="${origin}/widget.js" data-site-id="${workspace.value?.siteId ?? ''}" async>${closeScript}`
)

async function load() {
  if (!wid.value) return
  loading.value = true
  try {
    const [w, m] = await Promise.all([
      $fetch<WorkspaceDetail>(`/api/workspaces/${wid.value}`),
      $fetch<Member[]>(`/api/workspaces/${wid.value}/members`)
    ])
    workspace.value = w
    name.value = w.name
    members.value = m
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

async function changeRole(m: Member, role: 'admin' | 'agent') {
  try {
    await $fetch(`/api/workspaces/${wid.value}/members/${m.id}`, { method: 'PATCH', body: { role } })
    m.role = role
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not change role'), color: 'error' })
  }
}
async function removeMember(m: Member) {
  try {
    await $fetch(`/api/workspaces/${wid.value}/members/${m.id}`, { method: 'DELETE' })
    members.value = members.value.filter(x => x.id !== m.id)
    toast.add({ title: `Removed ${m.name}`, color: 'neutral' })
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not remove'), color: 'error' })
  }
}

async function createInvite() {
  const emailAddr = inviteEmail.value.trim()
  if (!emailAddr || inviting.value) return
  inviting.value = true
  try {
    const res = await $fetch<{ invites: { url: string }[] }>(`/api/workspaces/${wid.value}/invites`, {
      method: 'POST',
      body: { invites: [{ email: emailAddr, role: inviteRole.value }] }
    })
    inviteLink.value = res.invites[0]!.url
    inviteEmail.value = ''
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not create invite'), color: 'error' })
  } finally {
    inviting.value = false
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

function initials(n: string) {
  return n.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}
function presenceDot(status: string) {
  return status === 'online' ? 'bg-green-500' : status === 'away' ? 'bg-amber-400' : 'bg-zinc-500'
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
          v-for="n in 3"
          :key="n"
          class="h-32 w-full rounded-2xl"
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

        <!-- Team -->
        <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
          <h2 class="font-display font-semibold text-highlighted">
            Team
          </h2>
          <p class="text-sm text-muted mt-0.5">
            {{ members.length }} member{{ members.length === 1 ? '' : 's' }}.
          </p>

          <!-- invite -->
          <div
            v-if="isAdmin"
            class="mt-4 flex flex-col sm:flex-row gap-2"
          >
            <UInput
              v-model="inviteEmail"
              type="email"
              placeholder="teammate@company.com"
              size="lg"
              class="flex-1"
              @keyup.enter="createInvite"
            />
            <USelect
              v-model="inviteRole"
              :items="['agent', 'admin']"
              size="lg"
              class="w-full sm:w-28"
            />
            <UButton
              color="neutral"
              size="lg"
              :loading="inviting"
              icon="i-lucide-user-plus"
              @click="createInvite"
            >
              Invite
            </UButton>
          </div>
          <div
            v-if="inviteLink"
            class="mt-3 flex items-center gap-2 rounded-lg bg-default ring-1 ring-default px-3 py-2.5"
          >
            <UIcon
              name="i-lucide-link"
              class="size-4 text-dimmed shrink-0"
            />
            <span class="text-xs text-muted truncate flex-1">{{ inviteLink }}</span>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-copy"
              @click="copy(inviteLink, 'Invite link copied')"
            >
              Copy
            </UButton>
          </div>

          <!-- members -->
          <ul class="mt-5 divide-y divide-default/60">
            <li
              v-for="m in members"
              :key="m.id"
              class="flex items-center gap-3 py-3"
            >
              <span class="relative grid place-items-center size-9 shrink-0 rounded-full bg-elevated ring-1 ring-default text-xs font-semibold text-highlighted">
                {{ initials(m.name) }}
                <span
                  class="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-elevated"
                  :class="presenceDot(m.presence)"
                />
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-highlighted">
                  {{ m.name }}
                  <span
                    v-if="m.userId === user?.id"
                    class="text-xs text-dimmed font-normal"
                  >(you)</span>
                </p>
                <p class="truncate text-xs text-muted">
                  {{ m.email }}
                </p>
              </div>

              <template v-if="isAdmin && m.userId !== user?.id">
                <USelect
                  :model-value="m.role"
                  :items="['agent', 'admin']"
                  size="sm"
                  class="w-24"
                  @update:model-value="(r: string) => changeRole(m, r as 'admin' | 'agent')"
                />
                <UButton
                  color="error"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-user-minus"
                  square
                  aria-label="Remove"
                  @click="removeMember(m)"
                />
              </template>
              <UBadge
                v-else
                color="neutral"
                variant="subtle"
                size="sm"
                class="capitalize"
              >
                {{ m.role }}
              </UBadge>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </div>
</template>
