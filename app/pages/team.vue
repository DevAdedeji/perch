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
  openCount: number
  resolvedCount: number
  csatGood: number
  csatBad: number
}

const { currentWorkspace, user } = useAuth()
const toast = useToast()
const rt = useRealtime()

const wid = computed(() => currentWorkspace.value?.workspaceId ?? null)
const isAdmin = computed(() => currentWorkspace.value?.role === 'admin')
// cached across navigation — skeletons only on the first visit of a session
const members = useState<Member[]>('team:members', () => [])
const loading = ref(false)

const onlineCount = computed(() => members.value.filter(m => m.presence === 'online').length)

/* invite modal */
const inviteEmail = ref('')
const inviteRole = ref<'agent' | 'admin'>('agent')
const inviting = ref(false)
const inviteLink = ref('')
const inviteEmailed = ref(false)
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
    const res = await $fetch<{ invites: { url: string, emailed: boolean }[] }>(`/api/workspaces/${wid.value}/invites`, {
      method: 'POST',
      body: { invites: [{ email: emailAddr, role: inviteRole.value }] }
    })
    inviteLink.value = res.invites[0]!.url
    inviteEmailed.value = res.invites[0]!.emailed
    inviteEmail.value = ''
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not create invite'), color: 'error' })
  } finally {
    inviting.value = false
  }
}

/* data + live presence */
async function load() {
  if (!wid.value) return
  // stale-while-revalidate: render cached members instantly, refresh silently
  if (!members.value.length) loading.value = true
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

/* actions */
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
  return status === 'online' ? 'bg-green-500' : status === 'away' ? 'bg-amber-400' : 'bg-zinc-500'
}

function presenceText(p: string) {
  return p === 'online'
    ? 'text-green-600 dark:text-green-500'
    : p === 'away' ? 'text-amber-600 dark:text-amber-400' : 'text-dimmed'
}

// online first, then away, then offline — alphabetical within each group
const presenceRank = (p: string) => (p === 'online' ? 0 : p === 'away' ? 1 : 2)
const sortedMembers = computed(() =>
  [...members.value].sort((a, b) => presenceRank(a.presence) - presenceRank(b.presence) || a.name.localeCompare(b.name))
)

// §3.3 workload view: totals for the at-a-glance strip
const totalOpen = computed(() => members.value.reduce((n, m) => n + m.openCount, 0))

// §13.0.1 CSAT: percentage of thumbs-up among rated conversations
function csatLabel(m: Member): string {
  const total = m.csatGood + m.csatBad
  return total ? `${Math.round((m.csatGood / total) * 100)}%` : '—'
}
function csatTone(m: Member): string {
  const total = m.csatGood + m.csatBad
  if (!total) return 'text-dimmed'
  const pct = m.csatGood / total
  return pct >= 0.8
    ? 'font-semibold text-green-600 dark:text-green-500'
    : pct >= 0.5 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'font-semibold text-red-500'
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
            Who's on support, who's online, and who's carrying the load.
          </p>
        </div>
        <UButton
          v-if="isAdmin"
          color="primary"
          icon="i-lucide-user-plus"
          class="font-medium"
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

      <template v-else>
        <!-- at-a-glance -->
        <div class="mt-6 grid grid-cols-3 divide-x divide-default rounded-2xl border-glow bg-elevated/30 overflow-hidden">
          <div class="px-5 py-4">
            <p class="font-display text-2xl font-bold text-highlighted tabular-nums">
              {{ members.length }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Member{{ members.length === 1 ? '' : 's' }}
            </p>
          </div>
          <div class="px-5 py-4">
            <p class="font-display text-2xl font-bold tabular-nums text-green-600 dark:text-green-500">
              {{ onlineCount }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Online now
            </p>
          </div>
          <div class="px-5 py-4">
            <p class="font-display text-2xl font-bold text-highlighted tabular-nums">
              {{ totalOpen }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Open conversations
            </p>
          </div>
        </div>

        <!-- roster -->
        <div class="mt-4 rounded-2xl border-glow bg-elevated/30 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-elevated/50 text-[11px] uppercase tracking-wider text-dimmed">
                  <th class="px-4 sm:px-5 py-2.5 text-left font-medium">
                    Member
                  </th>
                  <th class="px-3 py-2.5 text-left font-medium">
                    Status
                  </th>
                  <th class="px-3 py-2.5 text-center font-medium">
                    Handling now
                  </th>
                  <th class="px-3 py-2.5 text-center font-medium">
                    Resolved
                  </th>
                  <th
                    class="px-3 py-2.5 text-center font-medium"
                    title="Thumbs-up share of rated conversations"
                  >
                    CSAT
                  </th>
                  <th class="px-3 py-2.5 text-left font-medium">
                    Role
                  </th>
                  <th
                    v-if="isAdmin"
                    class="px-3 py-2.5"
                  />
                </tr>
              </thead>
              <tbody class="divide-y divide-default/60">
                <tr
                  v-for="m in sortedMembers"
                  :key="m.id"
                  class="hover:bg-elevated/40 transition-colors"
                >
                  <td class="px-4 sm:px-5 py-3">
                    <div class="flex items-center gap-3 min-w-44">
                      <span class="grid place-items-center size-9 shrink-0 rounded-xl avatar-amber text-xs font-bold">
                        {{ initials(m.name) }}
                      </span>
                      <div class="min-w-0">
                        <p class="flex items-center gap-1.5 text-sm font-semibold text-highlighted">
                          <span class="truncate">{{ m.name }}</span>
                          <span
                            v-if="m.userId === user?.id"
                            class="shrink-0 text-[10px] font-normal text-dimmed"
                          >(you)</span>
                        </p>
                        <p class="truncate text-xs text-muted">
                          {{ m.email }}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td class="px-3 py-3 whitespace-nowrap">
                    <span class="flex items-center gap-1.5 text-xs capitalize">
                      <span
                        class="size-1.5 rounded-full"
                        :class="presenceDot(m.presence)"
                      />
                      <span :class="presenceText(m.presence)">{{ m.presence }}</span>
                    </span>
                  </td>
                  <td
                    class="px-3 py-3 text-center tabular-nums"
                    :class="m.openCount > 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-dimmed'"
                  >
                    {{ m.openCount }}
                  </td>
                  <td class="px-3 py-3 text-center tabular-nums text-muted">
                    {{ m.resolvedCount }}
                  </td>
                  <td
                    class="px-3 py-3 text-center tabular-nums"
                    :class="csatTone(m)"
                    :title="`${m.csatGood} 👍 · ${m.csatBad} 👎`"
                  >
                    {{ csatLabel(m) }}
                  </td>
                  <td class="px-3 py-3 whitespace-nowrap">
                    <USelect
                      v-if="isAdmin && m.userId !== user?.id"
                      :model-value="m.role"
                      :items="['agent', 'admin']"
                      size="sm"
                      class="w-24"
                      @update:model-value="(r: string) => changeRole(m, r as 'admin' | 'agent')"
                    />
                    <UBadge
                      v-else
                      color="neutral"
                      :variant="m.role === 'admin' ? 'subtle' : 'outline'"
                      size="sm"
                      class="capitalize"
                    >
                      {{ m.role }}
                    </UBadge>
                  </td>
                  <td
                    v-if="isAdmin"
                    class="px-3 py-3 text-right"
                  >
                    <UButton
                      v-if="m.userId !== user?.id"
                      color="error"
                      variant="ghost"
                      size="sm"
                      icon="i-lucide-user-minus"
                      square
                      aria-label="Remove"
                      @click="removeMember(m)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
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
            <template v-if="inviteEmailed">
              We’ve emailed the invite too. The link expires in 7 days.
            </template>
            <template v-else>
              Share this link — it expires in 7 days.
            </template>
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
              color="primary"
              class="font-medium"
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
