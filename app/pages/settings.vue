<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Settings · Perch' })

interface WorkspaceDetail {
  id: string
  name: string
  siteId: string
  widgetPrimaryColor: string
  prechatFormEnabled: boolean
  identityVerificationEnabled: boolean
  identitySecret: string | null
  allowedDomains: string[]
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
// optional: tell Perch who the signed-in user is, so pre-chat is skipped.
// window.perchIdentity is safe regardless of script order (the loader is async);
// Perch.identify() is for logins that happen after page load.
const identifySnippet = `<script>
  // if your user is signed in when the page renders:
  window.perchIdentity = {
    user_id: 'user_42',              // your platform's id for them
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    hash: '<generated on your server>' // required if verification is enforced
  }

  // or, after a login that happens without a page reload:
  // Perch.identify({ user_id, name, email, hash })
${closeScript}`

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
/* -- allowed domains ---------------------------- */
const domainInput = ref('')
const domainSaving = ref(false)

async function addDomain() {
  const entry = domainInput.value.trim()
  if (!entry || !workspace.value || domainSaving.value) return
  domainSaving.value = true
  try {
    await patchWorkspace({ allowedDomains: [...workspace.value.allowedDomains, entry] })
    domainInput.value = ''
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
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not remove domain'), color: 'error' })
  }
}

async function toggleIdentityVerification(value: boolean) {
  try {
    await patchWorkspace(
      { identityVerificationEnabled: value },
      value ? 'Unsigned identities will now be rejected' : 'Identity verification disabled'
    )
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

/* ── canned replies ───────────────────────────── */
interface Canned {
  id: string
  shortcut: string
  content: string
}

const canned = ref<Canned[]>([])
const cannedShortcut = ref('')
const cannedContent = ref('')
const cannedSaving = ref(false)

async function loadCanned() {
  if (!wid.value) return
  canned.value = await $fetch<Canned[]>(`/api/workspaces/${wid.value}/canned`)
}
onMounted(loadCanned)
watch(wid, loadCanned)

async function addCanned() {
  const shortcut = cannedShortcut.value.trim().replace(/^\//, '').toLowerCase()
  const content = cannedContent.value.trim()
  if (!shortcut || !content || cannedSaving.value) return
  cannedSaving.value = true
  try {
    const row = await $fetch<Canned>(`/api/workspaces/${wid.value}/canned`, {
      method: 'POST',
      body: { shortcut, content }
    })
    canned.value = [...canned.value, row].sort((a, b) => a.shortcut.localeCompare(b.shortcut))
    cannedShortcut.value = ''
    cannedContent.value = ''
    toast.add({ title: `/${row.shortcut} saved`, icon: 'i-lucide-check', color: 'success' })
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not save'), color: 'error' })
  } finally {
    cannedSaving.value = false
  }
}

async function removeCanned(c: Canned) {
  try {
    await $fetch(`/api/workspaces/${wid.value}/canned/${c.id}`, { method: 'DELETE' })
    canned.value = canned.value.filter(x => x.id !== c.id)
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not delete'), color: 'error' })
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
                  class="size-8 rounded-full ring-2 ring-offset-2 ring-offset-bg transition-transform hover:scale-110 disabled:opacity-60"
                  :class="workspace?.widgetPrimaryColor === c ? 'ring-highlighted' : 'ring-transparent'"
                  :style="{ background: c }"
                  :aria-label="c"
                  @click="setColor(c)"
                />
              </div>
            </div>
          </div>
        </section>

        <!-- Canned replies -->
        <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
          <h2 class="font-display font-semibold text-highlighted">
            Canned replies
          </h2>
          <p class="text-sm text-muted mt-0.5">
            Saved templates the whole team can insert by typing
            <span class="font-mono text-xs text-highlighted">/shortcut</span> in the composer.
          </p>

          <ul
            v-if="canned.length"
            class="mt-4 divide-y divide-default/60 rounded-xl ring-1 ring-default overflow-hidden"
          >
            <li
              v-for="c in canned"
              :key="c.id"
              class="group flex items-start gap-3 px-3.5 py-2.5 bg-default"
            >
              <span class="shrink-0 rounded-md bg-amber-500/10 ring-1 ring-amber-500/25 px-1.5 py-0.5 font-mono text-xs font-semibold text-amber-700 dark:text-amber-400">
                /{{ c.shortcut }}
              </span>
              <p class="min-w-0 flex-1 text-sm text-muted line-clamp-2">
                {{ c.content }}
              </p>
              <UButton
                class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                size="xs"
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                :aria-label="`Delete /${c.shortcut}`"
                @click="removeCanned(c)"
              />
            </li>
          </ul>
          <p
            v-else
            class="mt-4 rounded-xl ring-1 ring-default bg-default px-4 py-3 text-xs text-dimmed"
          >
            No canned replies yet — add your first below. Try <span class="font-mono">hello</span> →
            “Hi! Thanks for reaching out — how can I help?”
          </p>

          <form
            class="mt-4 space-y-3"
            @submit.prevent="addCanned"
          >
            <div class="flex gap-2">
              <UInput
                v-model="cannedShortcut"
                placeholder="shortcut (e.g. hello)"
                size="lg"
                class="w-44"
              >
                <template #leading>
                  <span class="font-mono text-sm text-dimmed">/</span>
                </template>
              </UInput>
              <UInput
                v-model="cannedContent"
                placeholder="The reply to insert…"
                size="lg"
                class="flex-1"
              />
              <UButton
                type="submit"
                color="primary"
                size="lg"
                icon="i-lucide-plus"
                :loading="cannedSaving"
                :disabled="!cannedShortcut.trim() || !cannedContent.trim()"
              >
                Add
              </UButton>
            </div>
          </form>
        </section>

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
                  v-if="isAdmin"
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
              v-if="isAdmin"
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
                :disabled="!isAdmin"
                @update:model-value="toggleIdentityVerification"
              />
            </div>

            <template v-if="isAdmin && workspace?.identitySecret">
              <div>
                <p class="text-sm font-medium text-highlighted">
                  Your identity secret
                </p>
                <p class="text-xs text-muted mb-2">
                  Keep this on your server — treat it like a password.
                </p>
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

          <div class="mt-5">
            <p class="text-sm font-medium text-highlighted">
              Know who you’re talking to <span class="ml-1 rounded-md bg-amber-500/10 ring-1 ring-amber-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">optional</span>
            </p>
            <p class="text-xs text-muted mt-0.5">
              If your visitors sign in on your site, pass their details and Perch skips the
              pre-chat form — agents see their real name and email.
            </p>
            <div class="mt-3 rounded-xl bg-default ring-1 ring-default overflow-hidden">
              <div class="flex items-center gap-2 px-4 py-2 border-b border-default bg-elevated/50">
                <UIcon
                  name="i-lucide-user-check"
                  class="size-4 text-dimmed"
                />
                <span class="text-xs font-mono text-dimmed">identify your user</span>
                <UButton
                  class="ml-auto"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-copy"
                  @click="copy(identifySnippet, 'Snippet copied')"
                >
                  Copy
                </UButton>
              </div>
              <pre class="p-4 text-xs font-mono text-highlighted overflow-x-auto whitespace-pre-wrap break-all">{{ identifySnippet }}</pre>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
