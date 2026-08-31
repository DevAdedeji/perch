<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Install Perch' })

interface InstallationData {
  workspace: {
    id: string
    name: string
    siteId: string
    logoUrl: string | null
    widgetPrimaryColor: string
    widgetGreeting: string
    widgetIntro: string
    widgetOfflineMessage: string
    widgetPosition: 'left' | 'right'
    widgetSize: 'compact' | 'standard' | 'large'
    widgetTheme: 'light' | 'dark' | 'system'
    widgetShowBranding: boolean
  }
  hasTestConversation: boolean
  installation: {
    lastSeenAt: string | null
    lastSeenUrl: string | null
  }
}

type VerificationReason = 'installed' | 'not_seen' | 'different_page' | 'stale' | 'domain_not_allowed'

interface VerificationResult {
  installed: boolean
  reason: VerificationReason
  requested: { url: string, origin: string, pathname: string }
  observed: { url: string, origin: string, pathname: string } | null
  observedAt: string | null
}

interface LocalProgress {
  reviewed: boolean
  copied: boolean
  websiteUrl: string
}

const { currentWorkspace } = useAuth()
const { copy } = useCopyToClipboard()
const toast = useToast()
const origin = useRequestURL().origin
const wid = computed(() => currentWorkspace.value?.workspaceId ?? null)
const isAdmin = computed(() => currentWorkspace.value?.role === 'admin')

const data = ref<InstallationData | null>(null)
const loading = ref(true)
const loadError = ref(false)
const local = reactive<LocalProgress>({ reviewed: false, copied: false, websiteUrl: '' })
const verification = ref<VerificationResult | null>(null)
const verifying = ref(false)
const verificationError = ref('')
const previewFrame = ref<HTMLIFrameElement | null>(null)

const storageKey = computed(() => `perch:installation:${wid.value ?? 'none'}`)
const snippet = computed(() => data.value ? buildEmbedSnippet(origin, data.value.workspace.siteId) : '')
const previewUrl = computed(() => data.value
  ? `/widget?site_id=${encodeURIComponent(data.value.workspace.siteId)}&preview=1`
  : '')

const steps = computed(() => [
  { label: 'Review your widget', done: local.reviewed },
  { label: 'Send a test message', done: data.value?.hasTestConversation ?? false },
  { label: 'Add the install code', done: local.copied },
  { label: 'Verify your website', done: verification.value?.installed ?? false }
])
const completedSteps = computed(() => steps.value.filter(step => step.done).length)
const allComplete = computed(() => completedSteps.value === steps.value.length)

function restoreLocalProgress() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey.value) ?? '{}') as Partial<LocalProgress>
    local.reviewed = stored.reviewed === true
    local.copied = stored.copied === true
    local.websiteUrl = typeof stored.websiteUrl === 'string' ? stored.websiteUrl : ''
  } catch {
    local.reviewed = false
    local.copied = false
    local.websiteUrl = ''
  }
}

function persistLocalProgress() {
  try {
    localStorage.setItem(storageKey.value, JSON.stringify({ ...local }))
  } catch {
    // The checklist still works for this visit when browser storage is unavailable.
  }
}

async function load(options: { silent?: boolean } = {}) {
  if (!wid.value || !isAdmin.value) {
    loading.value = false
    return
  }
  if (!options.silent) {
    loading.value = true
    loadError.value = false
  }
  try {
    data.value = await $fetch<InstallationData>(`/api/workspaces/${wid.value}/installation`)
  } catch {
    if (!options.silent) loadError.value = true
  } finally {
    if (!options.silent) loading.value = false
  }
}

function markReviewed() {
  local.reviewed = true
  persistLocalProgress()
  toast.add({ title: 'Widget preview approved', icon: 'i-lucide-check', color: 'success' })
}

async function copySnippet() {
  if (!snippet.value) return
  if (await copy(snippet.value, 'Install code copied')) {
    local.copied = true
    persistLocalProgress()
  }
}

function openPreview() {
  previewFrame.value?.contentWindow?.postMessage({ source: 'perch-host', perch: 'open' }, origin)
}

async function verifyInstallation(options: { quiet?: boolean } = {}) {
  const url = local.websiteUrl.trim()
  if (!url || !wid.value || verifying.value) return
  verifying.value = true
  verificationError.value = ''
  if (!options.quiet) verification.value = null
  try {
    verification.value = await $fetch<VerificationResult>(`/api/workspaces/${wid.value}/installation/verify`, {
      method: 'POST',
      body: { url }
    })
    local.websiteUrl = verification.value.requested.url
    persistLocalProgress()
  } catch (error) {
    verification.value = null
    verificationError.value = getErrorMessage(error, 'Could not check this website')
  } finally {
    verifying.value = false
  }
}

function observedWhen(value: string | null): string {
  if (!value) return ''
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function verificationCopy(result: VerificationResult): { title: string, body: string, tone: string, icon: string } {
  if (result.installed) {
    return {
      title: 'Perch is live on this page',
      body: `The widget loaded successfully at ${observedWhen(result.observedAt)}.`,
      tone: 'bg-green-500/10 ring-green-500/25 text-green-700 dark:text-green-400',
      icon: 'i-lucide-badge-check'
    }
  }
  if (result.reason === 'domain_not_allowed') {
    return {
      title: 'This domain is not allowed yet',
      body: 'Add the domain to Settings, then open the page again so Perch can load.',
      tone: 'bg-primary-500/10 ring-primary-500/25 text-primary-700 dark:text-primary-400',
      icon: 'i-lucide-shield-alert'
    }
  }
  if (result.reason === 'different_page') {
    return {
      title: 'Perch loaded on a different page',
      body: `We last saw it on ${result.observed?.url ?? 'another page'}. Open the exact URL above and retry.`,
      tone: 'bg-primary-500/10 ring-primary-500/25 text-primary-700 dark:text-primary-400',
      icon: 'i-lucide-route'
    }
  }
  if (result.reason === 'stale') {
    return {
      title: 'Reload the page for a fresh check',
      body: `Perch was last seen there at ${observedWhen(result.observedAt)}. Reload that page, then retry within 15 minutes.`,
      tone: 'bg-primary-500/10 ring-primary-500/25 text-primary-700 dark:text-primary-400',
      icon: 'i-lucide-history'
    }
  }
  return {
    title: 'Perch has not loaded there yet',
    body: 'Deploy the install code, open or reload that exact page, then retry this check.',
    tone: 'bg-primary-500/10 ring-primary-500/25 text-primary-700 dark:text-primary-400',
    icon: 'i-lucide-search-x'
  }
}

let statusTimer: ReturnType<typeof setInterval> | undefined
onMounted(async () => {
  restoreLocalProgress()
  await load()
  if (local.websiteUrl) await verifyInstallation({ quiet: true })
  statusTimer = setInterval(() => {
    if (!data.value?.hasTestConversation && document.visibilityState === 'visible') {
      void load({ silent: true })
    }
  }, 4_000)
})
onBeforeUnmount(() => clearInterval(statusTimer))
watch(wid, async () => {
  restoreLocalProgress()
  verification.value = null
  await load()
  if (local.websiteUrl) await verifyInstallation({ quiet: true })
})
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-5xl mx-auto p-5 sm:p-8">
      <div
        v-if="loading"
        class="space-y-4"
      >
        <USkeleton class="h-24 rounded-2xl" />
        <div class="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <USkeleton class="h-80 rounded-2xl" />
          <USkeleton class="h-[620px] rounded-2xl" />
        </div>
      </div>

      <div
        v-else-if="!isAdmin"
        class="rounded-2xl border-glow bg-elevated/30 px-6 py-12 text-center"
      >
        <UIcon
          name="i-lucide-lock-keyhole"
          class="mx-auto size-8 text-dimmed"
        />
        <h1 class="mt-3 font-display text-xl font-semibold text-highlighted">
          Admin access required
        </h1>
        <p class="mx-auto mt-1 max-w-md text-sm text-muted">
          A workspace admin needs to install and verify the support widget.
        </p>
        <UButton
          to="/dashboard"
          color="neutral"
          variant="outline"
          class="mt-4"
        >
          Back to inbox
        </UButton>
      </div>

      <div
        v-else-if="loadError || !data"
        class="rounded-2xl border-glow bg-elevated/30 px-6 py-12 text-center"
      >
        <UIcon
          name="i-lucide-cloud-alert"
          class="mx-auto size-8 text-dimmed"
        />
        <h1 class="mt-3 font-display text-xl font-semibold text-highlighted">
          Installation setup could not load
        </h1>
        <p class="mx-auto mt-1 max-w-md text-sm text-muted">
          Nothing was changed. Try loading the checklist again.
        </p>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          class="mt-4"
          @click="load()"
        >
          Try again
        </UButton>
      </div>

      <template v-else>
        <header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary-600 dark:text-primary-400">
              Launch checklist
            </p>
            <h1 class="mt-1 font-display text-2xl font-bold text-highlighted">
              Install Perch on your website
            </h1>
            <p class="mt-1 text-sm text-muted">
              Preview the experience, test it, paste one line of code, and confirm it is live.
            </p>
          </div>
          <UBadge
            :color="allComplete ? 'success' : 'neutral'"
            :variant="allComplete ? 'subtle' : 'outline'"
            size="lg"
            class="w-fit"
          >
            {{ completedSteps }} of {{ steps.length }} complete
          </UBadge>
        </header>

        <div class="mt-5 h-2 overflow-hidden rounded-full bg-elevated ring-1 ring-default">
          <div
            class="h-full rounded-full bg-primary-500 transition-[width] duration-500"
            :style="{ width: `${(completedSteps / steps.length) * 100}%` }"
          />
        </div>

        <div
          v-if="allComplete"
          class="mt-5 flex flex-col gap-3 rounded-2xl bg-green-500/10 p-5 ring-1 ring-green-500/25 sm:flex-row sm:items-center"
          role="status"
        >
          <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-green-500/15 text-green-600 dark:text-green-400">
            <UIcon
              name="i-lucide-party-popper"
              class="size-5"
            />
          </span>
          <div class="min-w-0 flex-1">
            <p class="font-display font-semibold text-green-700 dark:text-green-400">
              Your support widget is ready
            </p>
            <p class="mt-0.5 text-sm text-green-700/80 dark:text-green-400/80">
              Perch is installed, tested, and ready for customer conversations.
            </p>
          </div>
          <UButton
            to="/dashboard"
            color="success"
            trailing-icon="i-lucide-arrow-right"
          >
            Open inbox
          </UButton>
        </div>

        <div class="mt-6 grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside class="rounded-2xl border-glow bg-elevated/30 p-4 lg:sticky lg:top-6">
            <p class="px-1 text-xs font-medium uppercase tracking-wider text-dimmed">
              Your progress
            </p>
            <ol class="mt-3 space-y-1">
              <li
                v-for="(item, index) in steps"
                :key="item.label"
                class="flex items-center gap-3 rounded-xl px-3 py-2.5"
                :class="item.done ? 'bg-green-500/8' : 'bg-default/50'"
              >
                <span
                  class="grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1"
                  :class="item.done
                    ? 'bg-green-500/15 text-green-600 ring-green-500/25 dark:text-green-400'
                    : 'bg-elevated text-muted ring-default'"
                >
                  <UIcon
                    v-if="item.done"
                    name="i-lucide-check"
                    class="size-4"
                  />
                  <template v-else>{{ index + 1 }}</template>
                </span>
                <span
                  class="text-sm"
                  :class="item.done ? 'font-medium text-highlighted' : 'text-muted'"
                >
                  {{ item.label }}
                </span>
              </li>
            </ol>
            <p class="mt-4 px-1 text-xs leading-relaxed text-dimmed">
              You can leave and come back. Live test activity is saved to the workspace.
            </p>
          </aside>

          <div class="space-y-5">
            <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
              <div class="flex items-start gap-3">
                <span
                  class="grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ring-1"
                  :class="local.reviewed ? 'bg-green-500/15 text-green-600 ring-green-500/25 dark:text-green-400' : 'bg-elevated text-highlighted ring-default'"
                >
                  <UIcon
                    v-if="local.reviewed"
                    name="i-lucide-check"
                    class="size-4"
                  />
                  <template v-else>1</template>
                </span>
                <div class="min-w-0 flex-1">
                  <h2 class="font-display font-semibold text-highlighted">
                    Review your live widget
                  </h2>
                  <p class="mt-0.5 text-sm text-muted">
                    This is the same branded experience visitors will see.
                  </p>
                </div>
                <UButton
                  to="/settings"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-palette"
                >
                  Customize
                </UButton>
              </div>

              <div class="mt-5 overflow-hidden rounded-2xl bg-grid p-3 ring-1 ring-default sm:p-5">
                <div class="mx-auto max-w-[390px] overflow-hidden rounded-2xl bg-default shadow-xl ring-1 ring-black/10">
                  <div class="flex items-center gap-2 border-b border-default bg-elevated/60 px-3 py-2">
                    <span class="size-2.5 rounded-full bg-red-400/80" />
                    <span class="size-2.5 rounded-full bg-amber-400/80" />
                    <span class="size-2.5 rounded-full bg-green-400/80" />
                    <span class="ml-2 truncate font-mono text-[10px] text-dimmed">Live widget preview</span>
                  </div>
                  <iframe
                    ref="previewFrame"
                    :src="previewUrl"
                    title="Interactive Perch widget preview"
                    class="h-[560px] w-full border-0 bg-default"
                    sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                    @load="openPreview"
                  />
                </div>
              </div>

              <div class="mt-4 flex flex-col gap-3 rounded-xl bg-default p-3.5 ring-1 ring-default sm:flex-row sm:items-center">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-highlighted">
                    Happy with how it looks?
                  </p>
                  <p class="text-xs text-muted">
                    You can change the greeting, colors, size, and branding anytime.
                  </p>
                </div>
                <UButton
                  color="neutral"
                  :variant="local.reviewed ? 'subtle' : 'solid'"
                  :icon="local.reviewed ? 'i-lucide-check' : 'i-lucide-thumbs-up'"
                  :disabled="local.reviewed"
                  @click="markReviewed"
                >
                  {{ local.reviewed ? 'Looks good' : 'Use this look' }}
                </UButton>
              </div>
            </section>

            <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
              <div class="flex items-start gap-3">
                <span
                  class="grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ring-1"
                  :class="data.hasTestConversation ? 'bg-green-500/15 text-green-600 ring-green-500/25 dark:text-green-400' : 'bg-elevated text-highlighted ring-default'"
                >
                  <UIcon
                    v-if="data.hasTestConversation"
                    name="i-lucide-check"
                    class="size-4"
                  />
                  <template v-else>2</template>
                </span>
                <div class="min-w-0 flex-1">
                  <h2 class="font-display font-semibold text-highlighted">
                    Send a test conversation
                  </h2>
                  <p class="mt-0.5 text-sm text-muted">
                    Use the preview above to send any message. It will appear in your real inbox.
                  </p>
                </div>
              </div>
              <div
                class="mt-4 flex items-center gap-3 rounded-xl p-3.5 ring-1"
                :class="data.hasTestConversation
                  ? 'bg-green-500/10 text-green-700 ring-green-500/25 dark:text-green-400'
                  : 'bg-amber-500/8 text-amber-700 ring-amber-500/20 dark:text-amber-400'"
                role="status"
              >
                <UIcon
                  :name="data.hasTestConversation ? 'i-lucide-message-circle-check' : 'i-lucide-message-circle-dashed'"
                  class="size-5 shrink-0"
                />
                <p class="text-sm">
                  {{ data.hasTestConversation
                    ? 'Test message received — the full conversation flow works.'
                    : 'Waiting for a test message. This updates automatically.' }}
                </p>
                <UButton
                  v-if="data.hasTestConversation"
                  to="/dashboard"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  class="ml-auto"
                >
                  View inbox
                </UButton>
              </div>
            </section>

            <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
              <div class="flex items-start gap-3">
                <span
                  class="grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ring-1"
                  :class="local.copied ? 'bg-green-500/15 text-green-600 ring-green-500/25 dark:text-green-400' : 'bg-elevated text-highlighted ring-default'"
                >
                  <UIcon
                    v-if="local.copied"
                    name="i-lucide-check"
                    class="size-4"
                  />
                  <template v-else>3</template>
                </span>
                <div class="min-w-0 flex-1">
                  <h2 class="font-display font-semibold text-highlighted">
                    Add Perch to your website
                  </h2>
                  <p class="mt-0.5 text-sm text-muted">
                    Paste this once before the closing <code class="font-mono text-xs text-highlighted">&lt;/body&gt;</code> tag.
                  </p>
                </div>
              </div>

              <div class="mt-5 rounded-xl bg-zinc-950 ring-1 ring-white/10">
                <div class="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
                  <UIcon
                    name="i-lucide-code-xml"
                    class="size-4 text-zinc-400"
                  />
                  <span class="font-mono text-xs text-zinc-400">HTML · works with every framework</span>
                  <UButton
                    color="neutral"
                    variant="soft"
                    size="xs"
                    icon="i-lucide-copy"
                    class="ml-auto"
                    @click="copySnippet"
                  >
                    {{ local.copied ? 'Copy again' : 'Copy code' }}
                  </UButton>
                </div>
                <pre class="overflow-x-auto whitespace-pre-wrap break-all p-4 font-mono text-xs leading-relaxed text-zinc-100">{{ snippet }}</pre>
              </div>

              <ol class="mt-4 grid gap-2 text-sm text-muted sm:grid-cols-3">
                <li class="flex gap-2 rounded-lg bg-default p-3 ring-1 ring-default">
                  <span class="font-mono text-xs text-dimmed">01</span>
                  <span>Paste the code into your shared site layout.</span>
                </li>
                <li class="flex gap-2 rounded-lg bg-default p-3 ring-1 ring-default">
                  <span class="font-mono text-xs text-dimmed">02</span>
                  <span>Deploy your website as you normally do.</span>
                </li>
                <li class="flex gap-2 rounded-lg bg-default p-3 ring-1 ring-default">
                  <span class="font-mono text-xs text-dimmed">03</span>
                  <span>Open the live page once, then verify below.</span>
                </li>
              </ol>
            </section>

            <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
              <div class="flex items-start gap-3">
                <span
                  class="grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ring-1"
                  :class="verification?.installed ? 'bg-green-500/15 text-green-600 ring-green-500/25 dark:text-green-400' : 'bg-elevated text-highlighted ring-default'"
                >
                  <UIcon
                    v-if="verification?.installed"
                    name="i-lucide-check"
                    class="size-4"
                  />
                  <template v-else>4</template>
                </span>
                <div class="min-w-0 flex-1">
                  <h2 class="font-display font-semibold text-highlighted">
                    Verify the live installation
                  </h2>
                  <p class="mt-0.5 text-sm text-muted">
                    Perch confirms that the widget actually loaded on this exact page in the last 15 minutes.
                  </p>
                </div>
              </div>

              <form
                class="mt-5 flex flex-col gap-2 sm:flex-row"
                @submit.prevent="verifyInstallation()"
              >
                <UFormField
                  label="Customer page URL"
                  :error="verificationError"
                  class="min-w-0 flex-1"
                >
                  <UInput
                    v-model="local.websiteUrl"
                    type="url"
                    inputmode="url"
                    autocomplete="url"
                    placeholder="https://example.com"
                    size="lg"
                    icon="i-lucide-globe-2"
                    class="w-full"
                  />
                </UFormField>
                <UButton
                  type="submit"
                  color="primary"
                  size="lg"
                  icon="i-lucide-scan-search"
                  :loading="verifying"
                  :disabled="!local.websiteUrl.trim()"
                  class="sm:mt-6"
                >
                  Check installation
                </UButton>
              </form>

              <div
                v-if="verification"
                class="mt-4 rounded-xl p-4 ring-1"
                :class="verificationCopy(verification).tone"
                role="status"
                aria-live="polite"
              >
                <div class="flex items-start gap-3">
                  <UIcon
                    :name="verificationCopy(verification).icon"
                    class="mt-0.5 size-5 shrink-0"
                  />
                  <div class="min-w-0">
                    <p class="text-sm font-semibold">
                      {{ verificationCopy(verification).title }}
                    </p>
                    <p class="mt-0.5 text-sm opacity-85">
                      {{ verificationCopy(verification).body }}
                    </p>
                    <NuxtLink
                      v-if="verification.reason === 'domain_not_allowed'"
                      to="/settings"
                      class="mt-2 inline-flex text-sm font-medium underline underline-offset-2"
                    >
                      Open domain settings
                    </NuxtLink>
                  </div>
                </div>
              </div>

              <p class="mt-3 text-xs leading-relaxed text-dimmed">
                For privacy and security, Perch does not crawl your website. The check uses a signed signal sent only when your installed widget loads.
              </p>
            </section>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
