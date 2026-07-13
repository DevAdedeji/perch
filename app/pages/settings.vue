<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Settings · Perch' })

interface DayHours {
  open: string
  close: string
}
type BusinessHoursMap = Partial<Record<string, DayHours | null>>

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
  businessHours: BusinessHoursMap | null
  timezone: string | null
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

/* ── business hours ───────────────────────── */
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const DAY_NAMES: Record<string, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday'
}

const hoursEnabled = ref(false)
const tz = ref('')
const timezones = Intl.supportedValuesOf('timeZone')
const dayRows = reactive(Object.fromEntries(
  DAY_ORDER.map(d => [d, { on: false, open: '09:00', close: '17:00' }])
) as Record<string, { on: boolean, open: string, close: string }>)
const savingHours = ref(false)

// hydrate the editor whenever the workspace loads/switches
watch(workspace, (w) => {
  if (!w) return
  hoursEnabled.value = !!w.businessHours
  tz.value = w.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  for (const d of DAY_ORDER) {
    const range = w.businessHours?.[d]
    dayRows[d]!.on = !!range
    if (range) {
      dayRows[d]!.open = range.open
      dayRows[d]!.close = range.close
    }
  }
}, { immediate: true })

async function saveHours() {
  if (savingHours.value) return
  savingHours.value = true
  try {
    const businessHours = hoursEnabled.value
      ? Object.fromEntries(DAY_ORDER.map(d => [
          d,
          dayRows[d]!.on ? { open: dayRows[d]!.open, close: dayRows[d]!.close } : null
        ]))
      : null
    await patchWorkspace(
      { businessHours, timezone: hoursEnabled.value ? tz.value : workspace.value?.timezone ?? null },
      hoursEnabled.value ? 'Business hours saved' : 'Business hours turned off — always available'
    )
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not save business hours'), color: 'error' })
  } finally {
    savingHours.value = false
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

/* -- logo --------------------------------------- */
const { uploading: logoUploading, uploadImage } = useImageUpload()
const logoEl = ref<HTMLInputElement | null>(null)

function pickLogo() {
  logoEl.value?.click()
}

async function onLogoPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const img = await uploadImage(file)
    await patchWorkspace({ logoUrl: img.url }, 'Logo updated')
  } catch (err) {
    toast.add({ title: getErrorMessage(err, 'Could not upload the logo'), color: 'error' })
  }
}

async function removeLogo() {
  try {
    await patchWorkspace({ logoUrl: null }, 'Logo removed')
  } catch {
    toast.add({ title: 'Could not remove the logo', color: 'error' })
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
            <div>
              <p class="text-sm font-medium text-highlighted">
                Logo
              </p>
              <p class="text-xs text-muted mb-3">
                Shown in your widget's header and message bubbles instead of your initial.
              </p>
              <div class="flex items-center gap-3">
                <span class="grid place-items-center size-12 shrink-0 rounded-xl overflow-hidden avatar-amber text-base font-bold">
                  <img
                    v-if="workspace?.logoUrl"
                    :src="workspace.logoUrl"
                    class="size-full object-cover"
                    alt="Workspace logo"
                  >
                  <template v-else>{{ (workspace?.name ?? 'W').charAt(0).toUpperCase() }}</template>
                </span>
                <input
                  ref="logoEl"
                  type="file"
                  accept="image/*"
                  class="hidden"
                  @change="onLogoPicked"
                >
                <UButton
                  size="sm"
                  color="neutral"
                  variant="subtle"
                  icon="i-lucide-upload"
                  :loading="logoUploading"
                  :disabled="!isAdmin"
                  @click="pickLogo"
                >
                  Upload logo
                </UButton>
                <UButton
                  v-if="workspace?.logoUrl"
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  :disabled="!isAdmin"
                  @click="removeLogo"
                >
                  Remove
                </UButton>
              </div>
            </div>

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

        <!-- Business hours -->
        <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
          <div class="flex items-center justify-between gap-4">
            <div>
              <h2 class="font-display font-semibold text-highlighted">
                Business hours
              </h2>
              <p class="text-sm text-muted mt-0.5">
                Outside these hours the widget shows visitors when you'll be back —
                even if someone from the team is online.
              </p>
            </div>
            <USwitch
              v-model="hoursEnabled"
              :disabled="!isAdmin"
            />
          </div>

          <div
            v-if="hoursEnabled"
            class="mt-5 space-y-4"
          >
            <UFormField label="Timezone">
              <USelectMenu
                v-model="tz"
                :items="timezones"
                :disabled="!isAdmin"
                size="lg"
                class="w-full sm:w-80"
              />
            </UFormField>

            <div class="rounded-xl ring-1 ring-default divide-y divide-default/60 overflow-hidden">
              <div
                v-for="d in DAY_ORDER"
                :key="d"
                class="flex items-center gap-3 px-3.5 py-2.5 bg-default"
              >
                <USwitch
                  v-model="dayRows[d]!.on"
                  :disabled="!isAdmin"
                  size="sm"
                />
                <span
                  class="w-24 text-sm"
                  :class="dayRows[d]!.on ? 'font-medium text-highlighted' : 'text-dimmed'"
                >{{ DAY_NAMES[d] }}</span>
                <template v-if="dayRows[d]!.on">
                  <UInput
                    v-model="dayRows[d]!.open"
                    type="time"
                    size="sm"
                    :disabled="!isAdmin"
                    class="w-28"
                  />
                  <span class="text-xs text-dimmed">to</span>
                  <UInput
                    v-model="dayRows[d]!.close"
                    type="time"
                    size="sm"
                    :disabled="!isAdmin"
                    class="w-28"
                  />
                </template>
                <span
                  v-else
                  class="text-xs text-dimmed"
                >Closed</span>
              </div>
            </div>
          </div>

          <UButton
            v-if="isAdmin"
            class="mt-4"
            color="neutral"
            :loading="savingHours"
            @click="saveHours"
          >
            Save hours
          </UButton>
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

          <p
            v-if="isAdmin"
            class="mt-5 text-xs text-dimmed"
          >
            Looking for allowed domains, identity verification, the audit log, or workspace deletion?
            They live on the <NuxtLink
              to="/admin"
              class="text-amber-600 dark:text-amber-400 hover:underline"
            >Admin page</NuxtLink>.
          </p>
        </section>
      </template>
    </div>
  </div>
</template>
