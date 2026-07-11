<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Admin · Perch' })

interface WorkspaceDetail {
  id: string
  name: string
  siteId: string
  logoUrl: string | null
  widgetPrimaryColor: string
  prechatFormEnabled: boolean
  identityVerificationEnabled: boolean
  identitySecret: string | null
  allowedDomains: string[]
  role: 'admin' | 'agent'
}

const { currentWorkspace, refresh } = useAuth()
const toast = useToast()

const wid = computed(() => currentWorkspace.value?.workspaceId ?? null)
const workspace = ref<WorkspaceDetail | null>(null)
const loading = ref(true)
const isAdmin = computed(() => workspace.value?.role === 'admin')

// how the business's backend signs the identity (never expose the secret client-side)
const signSnippet = `// Node.js — on YOUR server, never in the browser
import { createHmac } from 'node:crypto'

const hash = createHmac('sha256', PERCH_IDENTITY_SECRET)
  .update(user.id) // or user.email if you don't pass user_id
  .digest('hex')`

async function load() {
  if (!wid.value) return
  loading.value = true
  try {
    workspace.value = await $fetch<WorkspaceDetail>(`/api/workspaces/${wid.value}`)
    loadAudit()
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

async function copy(text: string, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: label, icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Copy failed', color: 'error' })
  }
}

/* ── allowed domains ── */
const domainInput = ref('')
const domainSaving = ref(false)

async function addDomain() {
  const entry = domainInput.value.trim()
  if (!entry || !workspace.value || domainSaving.value) return
  domainSaving.value = true
  try {
    await patchWorkspace({ allowedDomains: [...workspace.value.allowedDomains, entry] })
    domainInput.value = ''
    loadAudit()
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not add domain'), color: 'error' })
  } finally {
    domainSaving.value = false
  }
}

async function removeDomain(domain: string) {
  if (!workspace.value) return
  try {
    await patchWorkspace({ allowedDomains: workspace.value.allowedDomains.filter(d => d !== domain) })
    loadAudit()
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not remove domain'), color: 'error' })
  }
}

/* ── identity verification ── */
async function toggleIdentityVerification(value: boolean) {
  try {
    await patchWorkspace(
      { identityVerificationEnabled: value },
      value ? 'Unsigned identities will now be rejected' : 'Identity verification disabled'
    )
    loadAudit()
  } catch {
    toast.add({ title: 'Could not update', color: 'error' })
  }
}

/* ── identity secret rotation (arm-then-confirm, no modal) ── */
const rotatingSecret = ref(false)
const rotateArmed = ref(false)
let disarmTimer: ReturnType<typeof setTimeout> | undefined

async function rotateIdentitySecret() {
  if (!rotateArmed.value) {
    rotateArmed.value = true
    clearTimeout(disarmTimer)
    disarmTimer = setTimeout(() => {
      rotateArmed.value = false
    }, 4000)
    return
  }
  rotateArmed.value = false
  clearTimeout(disarmTimer)
  rotatingSecret.value = true
  try {
    const res = await $fetch<{ identitySecret: string }>(`/api/workspaces/${wid.value}/identity-secret`, { method: 'POST' })
    if (workspace.value) workspace.value.identitySecret = res.identitySecret
    toast.add({
      title: 'Identity secret rotated',
      description: 'Update the secret on your server — old signatures no longer validate.',
      icon: 'i-lucide-refresh-cw',
      color: 'warning'
    })
    loadAudit()
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not rotate the secret'), color: 'error' })
  } finally {
    rotatingSecret.value = false
  }
}

/* ── audit log ── */
interface AuditRow {
  id: string
  actor_name: string
  action: string
  detail: Record<string, unknown>
  created_at: string
}

const auditRows = ref<AuditRow[]>([])
const auditLoaded = ref(false)

const AUDIT_LABELS: Record<string, string> = {
  'settings.updated': 'updated workspace settings',
  'member.role_changed': 'changed a member role',
  'member.removed': 'removed a member',
  'member.joined': 'joined the workspace',
  'invite.sent': 'sent invites',
  'identity_secret.rotated': 'rotated the identity secret'
}

function auditLabel(row: AuditRow) {
  return AUDIT_LABELS[row.action] ?? row.action
}

function auditDetail(row: AuditRow) {
  const d = row.detail
  switch (row.action) {
    case 'settings.updated': return (d.changed as string[] | undefined)?.join(', ') ?? ''
    case 'member.role_changed': return `${d.member}: ${d.from} → ${d.to}`
    case 'member.removed': return `${d.member} (${d.role})`
    case 'member.joined': return `as ${d.role}`
    case 'invite.sent': return (d.invites as { email: string }[] | undefined)?.map(i => i.email).join(', ') ?? ''
    default: return ''
  }
}

function auditWhen(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

async function loadAudit() {
  if (!wid.value || !isAdmin.value) return
  try {
    auditRows.value = await $fetch<AuditRow[]>(`/api/workspaces/${wid.value}/audit`)
  } catch {
    // informational — never block the page on it
  } finally {
    auditLoaded.value = true
  }
}

/* ── danger zone: workspace delete ── */
const deleteWsOpen = ref(false)
const deleteWsConfirm = ref('')
const deletingWs = ref(false)

async function deleteWorkspace() {
  if (deleteWsConfirm.value.trim() !== workspace.value?.name || deletingWs.value) return
  deletingWs.value = true
  try {
    await $fetch(`/api/workspaces/${wid.value}`, { method: 'DELETE' })
    deleteWsOpen.value = false
    toast.add({ title: 'Workspace deleted', color: 'neutral' })
    await refresh()
    await navigateTo('/dashboard')
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not delete workspace'), color: 'error' })
  } finally {
    deletingWs.value = false
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-2xl mx-auto p-5 sm:p-8 space-y-8">
      <h1 class="font-display text-2xl font-bold text-highlighted">
        Admin
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

      <!-- agents don't belong here (the sidebar hides the link, but URLs are typeable) -->
      <div
        v-else-if="!isAdmin"
        class="rounded-2xl border-glow bg-elevated/30 p-8 text-center"
      >
        <UIcon
          name="i-lucide-lock"
          class="mx-auto size-7 text-dimmed"
        />
        <p class="mt-3 text-sm text-muted">
          This page is for workspace admins.
        </p>
      </div>

      <template v-else>
        <!-- Allowed domains -->
        <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
          <h2 class="font-display font-semibold text-highlighted">
            Allowed domains
          </h2>
          <p class="text-sm text-muted mt-0.5">
            Restrict which websites can embed your chat. Anyone can read your
            <span class="font-mono text-xs text-highlighted">site_id</span> from your page source —
            this stops strangers using it. Leave empty to allow any site.
          </p>

          <div class="mt-4 space-y-3">
            <div
              v-if="workspace?.allowedDomains.length"
              class="flex flex-wrap gap-2"
            >
              <span
                v-for="d in workspace.allowedDomains"
                :key="d"
                class="inline-flex items-center gap-1.5 rounded-lg bg-default ring-1 ring-default pl-2.5 pr-1 py-1 font-mono text-xs text-highlighted"
              >
                {{ d }}
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-x"
                  square
                  :aria-label="`Remove ${d}`"
                  @click="removeDomain(d)"
                />
              </span>
            </div>
            <p
              v-else
              class="rounded-xl ring-1 ring-default bg-default px-4 py-3 text-xs text-dimmed"
            >
              No restrictions — the widget works on any site that has your snippet.
            </p>

            <form
              class="flex gap-2"
              @submit.prevent="addDomain"
            >
              <UInput
                v-model="domainInput"
                placeholder="yourdomain.com"
                size="lg"
                class="flex-1"
              />
              <UButton
                type="submit"
                color="primary"
                size="lg"
                icon="i-lucide-plus"
                :loading="domainSaving"
                :disabled="!domainInput.trim()"
              >
                Add
              </UButton>
            </form>
            <p
              v-if="workspace?.allowedDomains.length"
              class="text-xs text-dimmed"
            >
              Subdomains are included automatically (adding <span class="font-mono">example.com</span>
              also allows <span class="font-mono">app.example.com</span>). Make sure your own site is on the list.
            </p>
          </div>
        </section>

        <!-- Identity verification -->
        <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
          <h2 class="font-display font-semibold text-highlighted">
            Identity verification
          </h2>
          <p class="text-sm text-muted mt-0.5">
            Prove that identities passed via <span class="font-mono text-xs text-highlighted">Perch.identify()</span>
            really come from your server — visitors can’t impersonate each other.
          </p>

          <div class="mt-5 space-y-5">
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="text-sm font-medium text-highlighted">
                  Require verified identities
                </p>
                <p class="text-xs text-muted">
                  When on, identify() calls without a valid signature are rejected.
                </p>
              </div>
              <USwitch
                :model-value="workspace?.identityVerificationEnabled"
                @update:model-value="toggleIdentityVerification"
              />
            </div>

            <template v-if="workspace?.identitySecret">
              <div>
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="text-sm font-medium text-highlighted">
                      Your identity secret
                    </p>
                    <p class="text-xs text-muted mb-2">
                      Keep this on your server — treat it like a password.
                    </p>
                  </div>
                  <UButton
                    :color="rotateArmed ? 'warning' : 'neutral'"
                    variant="outline"
                    size="xs"
                    icon="i-lucide-refresh-cw"
                    :loading="rotatingSecret"
                    @click="rotateIdentitySecret"
                  >
                    {{ rotateArmed ? 'Really rotate?' : 'Rotate' }}
                  </UButton>
                </div>
                <button
                  class="w-full truncate rounded-lg bg-default ring-1 ring-default px-3 py-2 text-left font-mono text-xs text-muted hover:text-highlighted transition-colors"
                  title="Copy identity secret"
                  @click="copy(workspace.identitySecret, 'Secret copied')"
                >
                  {{ workspace.identitySecret }}
                </button>
              </div>

              <div class="rounded-xl bg-default ring-1 ring-default overflow-hidden">
                <div class="flex items-center gap-2 px-4 py-2 border-b border-default bg-elevated/50">
                  <UIcon
                    name="i-lucide-shield-check"
                    class="size-4 text-dimmed"
                  />
                  <span class="text-xs font-mono text-dimmed">sign the identity on your server</span>
                  <UButton
                    class="ml-auto"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-copy"
                    @click="copy(signSnippet, 'Snippet copied')"
                  >
                    Copy
                  </UButton>
                </div>
                <pre class="p-4 text-xs font-mono text-highlighted overflow-x-auto whitespace-pre-wrap break-all">{{ signSnippet }}</pre>
              </div>
            </template>
          </div>
        </section>

        <!-- Audit log -->
        <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
          <h2 class="font-display font-semibold text-highlighted">
            Audit log
          </h2>
          <p class="text-sm text-muted mt-0.5">
            Sensitive changes in this workspace — who did what, when.
          </p>

          <p
            v-if="auditLoaded && !auditRows.length"
            class="mt-5 text-sm text-dimmed"
          >
            Nothing yet. Settings changes, role changes, invites, and secret rotations will show up here.
          </p>

          <ul
            v-else
            class="mt-5 space-y-1"
          >
            <li
              v-for="row in auditRows.slice(0, 20)"
              :key="row.id"
              class="flex items-baseline gap-2 rounded-lg px-3 py-2 hover:bg-elevated/50 transition-colors"
            >
              <span class="text-sm text-highlighted font-medium shrink-0">{{ row.actor_name }}</span>
              <span class="text-sm text-muted min-w-0 truncate">
                {{ auditLabel(row) }}<template v-if="auditDetail(row)"> — {{ auditDetail(row) }}</template>
              </span>
              <span class="ml-auto shrink-0 text-xs text-dimmed font-mono">{{ auditWhen(row.created_at) }}</span>
            </li>
          </ul>
        </section>

        <!-- Danger zone -->
        <section class="rounded-2xl ring-1 ring-red-500/25 bg-red-500/4 p-5 sm:p-6">
          <h2 class="font-display font-semibold text-red-600 dark:text-red-400">
            Danger zone
          </h2>
          <p class="text-sm text-muted mt-0.5">
            This is permanent. There is no undo and no soft delete.
          </p>

          <div class="mt-5 flex items-center justify-between gap-4">
            <div>
              <p class="text-sm font-medium text-highlighted">
                Delete this workspace
              </p>
              <p class="text-xs text-muted">
                Removes every conversation, message, visitor, and teammate in
                <span class="font-medium text-highlighted">{{ workspace?.name }}</span>.
              </p>
            </div>
            <UButton
              color="error"
              variant="subtle"
              @click="deleteWsOpen = true"
            >
              Delete workspace
            </UButton>
          </div>
        </section>
      </template>
    </div>

    <!-- delete workspace confirm -->
    <UModal
      v-model:open="deleteWsOpen"
      title="Delete this workspace?"
      :description="`Every conversation, visitor, and teammate in ${workspace?.name ?? 'this workspace'} will be permanently deleted.`"
    >
      <template #body>
        <UFormField :label="`Type “${workspace?.name}” to confirm`">
          <UInput
            v-model="deleteWsConfirm"
            size="lg"
            class="w-full"
            :placeholder="workspace?.name"
          />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            @click="deleteWsOpen = false"
          >
            Cancel
          </UButton>
          <UButton
            color="error"
            :loading="deletingWs"
            :disabled="deleteWsConfirm.trim() !== workspace?.name"
            @click="deleteWorkspace"
          >
            Delete forever
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
