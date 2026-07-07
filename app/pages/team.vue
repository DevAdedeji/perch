<script setup lang="ts">
import type { ServerEvent } from '@perch/shared'

definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Team · Perch' })

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
const rt = useRealtime()

const wid = computed(() => currentWorkspace.value?.workspaceId ?? null)
const isAdmin = computed(() => currentWorkspace.value?.role === 'admin')
const members = ref<Member[]>([])
const loading = ref(true)

const onlineCount = computed(() => members.value.filter(m => m.presence === 'online').length)

/* ── invite modal ─────────────────────────────── */
const inviteEmail = ref('')
const inviteRole = ref<'agent' | 'admin'>('agent')
const inviting = ref(false)
const inviteLink = ref('')
const inviteModalOpen = ref(false)

function openInvite() {
  inviteEmail.value = ''
  inviteLink.value = ''
  inviteRole.value = 'agent'
  inviteModalOpen.value = true
}
function inviteAnother() {
  inviteEmail.value = ''
  inviteLink.value = ''
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

/* ── data + live presence ─────────────────────── */
async function load() {
  if (!wid.value) return
  loading.value = true
  try {
    members.value = await $fetch<Member[]>(`/api/workspaces/${wid.value}/members`)
  } finally {
    loading.value = false
  }
}

function onEvent(ev: ServerEvent) {
  if (ev.type === 'presence') {
    const m = members.value.find(x => x.id === ev.payload.member_id)
    if (m) m.presence = ev.payload.presence
  }
}

// the workspace channel is owned by the dashboard layout; we just listen
let off: (() => void) | undefined
onMounted(() => {
  rt.connect()
  off = rt.on(onEvent)
  load()
})
onBeforeUnmount(() => off?.())
watch(wid, load)

/* ── actions ──────────────────────────────────── */
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
  return status === 'online' ? 'bg-green-500' : status === 'away' ? 'bg-amber-400' : 'bg-red-500'
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-3xl mx-auto p-5 sm:p-8">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h1 class="font-display text-2xl font-bold text-highlighted">
            Team
          </h1>
          <p class="text-sm text-muted mt-0.5">
            {{ members.length }} member{{ members.length === 1 ? '' : 's' }} · {{ onlineCount }} online
          </p>
        </div>
        <UButton
          v-if="isAdmin"
          color="neutral"
          icon="i-lucide-user-plus"
          @click="openInvite"
        >
          Invite
        </UButton>
      </div>

      <div
        v-if="loading"
        class="mt-6 space-y-2"
      >
        <USkeleton
          v-for="n in 4"
          :key="n"
          class="h-16 w-full rounded-xl"
        />
      </div>

      <div
        v-else
        class="mt-6 rounded-2xl border-glow bg-elevated/30 overflow-hidden"
      >
        <ul class="divide-y divide-default/60">
          <li
            v-for="m in members"
            :key="m.id"
            class="flex items-center gap-3 px-4 sm:px-5 py-3.5"
          >
            <span class="relative grid place-items-center size-10 shrink-0 rounded-full bg-elevated ring-1 ring-default text-sm font-semibold text-highlighted">
              {{ initials(m.name) }}
              <span
                class="absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-elevated"
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

            <span class="hidden sm:block text-xs capitalize text-dimmed mr-1">{{ m.presence }}</span>

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
      </div>
    </div>

    <!-- invite modal -->
    <UModal
      v-model:open="inviteModalOpen"
      title="Invite a teammate"
      description="They’ll join this workspace when they open the link."
    >
      <template #body>
        <div
          v-if="!inviteLink"
          class="space-y-4"
        >
          <UFormField label="Email">
            <UInput
              v-model="inviteEmail"
              type="email"
              placeholder="teammate@company.com"
              size="lg"
              autofocus
              class="w-full"
              @keyup.enter="createInvite"
            />
          </UFormField>
          <UFormField label="Role">
            <USelect
              v-model="inviteRole"
              :items="['agent', 'admin']"
              size="lg"
              class="w-full"
            />
          </UFormField>
        </div>

        <div
          v-else
          class="space-y-3"
        >
          <div class="flex items-center gap-2 rounded-lg bg-elevated ring-1 ring-default px-3 py-2.5">
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
          <p class="text-xs text-muted">
            Share this link — it expires in 7 days.
          </p>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <template v-if="!inviteLink">
            <UButton
              color="neutral"
              variant="ghost"
              @click="inviteModalOpen = false"
            >
              Cancel
            </UButton>
            <UButton
              color="neutral"
              :loading="inviting"
              :disabled="!inviteEmail.trim()"
              @click="createInvite"
            >
              Create invite link
            </UButton>
          </template>
          <template v-else>
            <UButton
              color="neutral"
              variant="ghost"
              @click="inviteAnother"
            >
              Invite another
            </UButton>
            <UButton
              color="neutral"
              @click="inviteModalOpen = false"
            >
              Done
            </UButton>
          </template>
        </div>
      </template>
    </UModal>
  </div>
</template>
