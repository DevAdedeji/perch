<script setup lang="ts">
import { defaultNotificationPreferences, PERCH_PRO_PLAN } from '@perch/shared'
import type { NotificationCategory, NotificationPreference } from '@perch/shared'

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
  widgetGreeting: string
  widgetIntro: string
  widgetOfflineMessage: string
  widgetPosition: 'left' | 'right'
  widgetSize: 'compact' | 'standard' | 'large'
  widgetTheme: 'light' | 'dark' | 'system'
  widgetShowBranding: boolean
  prechatFormEnabled: boolean
  identityVerificationEnabled: boolean
  identitySecret: string | null
  allowedDomains: string[]
  businessHours: BusinessHoursMap | null
  timezone: string | null
  unansweredReminderEnabled: boolean
  unansweredReminderDelayMinutes: number
  unansweredReminderBusinessHoursOnly: boolean
  visitorReplyEmailAvailable: boolean
  visitorReplyEmailEnabled: boolean
  entitlement: {
    isPro: boolean
    plan: 'free' | 'pro'
    features: { customReminderDelay: boolean, businessHoursReminders: boolean, removeBranding: boolean }
  }
  role: 'admin' | 'agent'
}

const { user, currentWorkspace } = useAuth()
const toast = useToast()
const { copy } = useCopyToClipboard()
const origin = useRequestURL().origin

const wid = computed(() => currentWorkspace.value?.workspaceId ?? null)
const workspace = ref<WorkspaceDetail | null>(null)
const loading = ref(true)
const isAdmin = computed(() => workspace.value?.role === 'admin')

const name = ref('')
const widgetEditor = ref(widgetAppearanceDefaults())
const savingWidget = ref(false)
const prefersDark = ref(false)
let colorSchemeQuery: MediaQueryList | null = null
const syncPreferredColorScheme = () => {
  prefersDark.value = colorSchemeQuery?.matches ?? false
}
const previewDark = computed(() => widgetEditor.value.widgetTheme === 'dark'
  || (widgetEditor.value.widgetTheme === 'system' && prefersDark.value))
const previewWidth = computed(() => ({
  compact: '13.5rem',
  standard: '16rem',
  large: '18rem'
})[widgetEditor.value.widgetSize])

// closing tag split so it doesn't terminate this SFC <script> block
const closeScript = '</' + 'script>'
const snippet = computed(() => workspace.value ? buildEmbedSnippet(origin, workspace.value.siteId) : '')
// optional: tell Perch who the signed-in user is, so pre-chat is skipped.
// window.perchIdentity is safe regardless of script order (the loader is async);
// Perch.identify() is for logins that happen after page load.
const identifySnippet = `<script>
  // if your user is signed in when the page renders:
  window.perchIdentity = {
    user_id: 'user_42',              // your platform's id for them
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    hash: '<HMAC of user_id>',
    email_hash: '<HMAC of normalized email>' // proves the address; the visitor still opts in
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
onMounted(() => {
  load()
  colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
  syncPreferredColorScheme()
  colorSchemeQuery.addEventListener('change', syncPreferredColorScheme)
})
onBeforeUnmount(() => colorSchemeQuery?.removeEventListener('change', syncPreferredColorScheme))
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
async function toggleVisitorReplyEmail(value: boolean) {
  try {
    await patchWorkspace({ visitorReplyEmailEnabled: value })
  } catch {
    toast.add({ title: 'Could not update visitor reply emails', color: 'error' })
  }
}
watch(workspace, (w) => {
  if (!w) return
  widgetEditor.value = pickWidgetAppearance(w)
}, { immediate: true })

async function saveWidgetCustomization() {
  if (savingWidget.value || !isAdmin.value) return
  savingWidget.value = true
  try {
    await patchWorkspace({ ...widgetEditor.value }, 'Widget appearance saved')
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not save widget appearance'), color: 'error' })
  } finally {
    savingWidget.value = false
  }
}

/* business hours */
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

/* response target and unanswered-message email reminders */
const reminderEnabled = ref(false)
const reminderDelay = ref(15)
const reminderBusinessHoursOnly = ref(false)
const savingReminder = ref(false)
const reminderOptions = [
  { label: '5 minutes', value: 5 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '4 hours', value: 240 },
  { label: '24 hours', value: 1440 }
]

watch(workspace, (w) => {
  if (!w) return
  reminderEnabled.value = w.unansweredReminderEnabled
  reminderDelay.value = w.entitlement.isPro ? w.unansweredReminderDelayMinutes : PERCH_PRO_PLAN.freeReminderMinutes
  reminderBusinessHoursOnly.value = w.unansweredReminderBusinessHoursOnly
}, { immediate: true })

async function saveReminder() {
  if (savingReminder.value || !isAdmin.value) return
  savingReminder.value = true
  try {
    await patchWorkspace({
      unansweredReminderEnabled: reminderEnabled.value,
      unansweredReminderDelayMinutes: reminderDelay.value,
      unansweredReminderBusinessHoursOnly: reminderBusinessHoursOnly.value
    }, reminderEnabled.value ? 'Email reminders saved' : 'Email reminders turned off')
  } catch (error) {
    toast.add({ title: getErrorMessage(error, 'Could not save email reminders'), color: 'error' })
  } finally {
    savingReminder.value = false
  }
}

/* personal notifications */
const browserNotifications = useBrowserNotifications()
const personalNotificationStore = usePersonalNotificationPreferences()
const personalNotificationScope = computed(() => user.value?.id && wid.value
  ? notificationPreferenceScope(user.value.id, wid.value)
  : null)
const personalNotifications = ref<NotificationPreference[]>(defaultNotificationPreferences())
const notificationsLoading = ref(true)
const notificationsSaving = ref(false)
const notificationMeta: Array<{
  category: NotificationCategory
  title: string
  description: string
}> = [
  {
    category: 'assignment',
    title: 'Assignments',
    description: 'When a teammate assigns a conversation to you.'
  },
  {
    category: 'mention',
    title: 'Mentions',
    description: 'When a teammate mentions you in Nest or an internal note.'
  },
  {
    category: 'unanswered_reminder',
    title: 'Unanswered-message reminders',
    description: 'When a conversation passes the workspace response target.'
  }
]

function personalPreference(category: NotificationCategory) {
  return personalNotifications.value.find(item => item.category === category)!
}

async function loadPersonalNotifications() {
  const workspaceId = wid.value
  const scope = personalNotificationScope.value
  if (!workspaceId || !scope) return
  notificationsLoading.value = true
  browserNotifications.refreshPermission()
  try {
    const preferences = await personalNotificationStore.load(scope, workspaceId)
    if (!preferences || personalNotificationScope.value !== scope) return
    personalNotifications.value = preferences.map(preference => ({ ...preference }))
  } catch (error) {
    if (personalNotificationScope.value === scope) {
      personalNotifications.value = defaultNotificationPreferences()
      toast.add({ title: getErrorMessage(error, 'Could not load your notification preferences'), color: 'error' })
    }
  } finally {
    if (personalNotificationScope.value === scope) notificationsLoading.value = false
  }
}

async function setBrowserPreference(preference: NotificationPreference, enabled: boolean) {
  if (!enabled) {
    preference.browser_enabled = false
    return
  }
  const permission = await browserNotifications.requestPermission()
  if (permission === 'granted') {
    preference.browser_enabled = true
    return
  }
  toast.add({
    title: permission === 'denied' ? 'Browser notifications are blocked' : 'Browser notifications are unavailable',
    description: permission === 'denied'
      ? 'Allow notifications for this site in your browser settings, then try again.'
      : 'Use a secure, supported browser to enable these alerts.',
    color: 'warning'
  })
}

async function savePersonalNotifications() {
  const workspaceId = wid.value
  const scope = personalNotificationScope.value
  if (!workspaceId || !scope || notificationsSaving.value) return
  notificationsSaving.value = true
  try {
    const result = await $fetch<{ preferences: NotificationPreference[] }>(
      `/api/workspaces/${workspaceId}/notification-preferences`,
      { method: 'PATCH', body: { preferences: personalNotifications.value } }
    )
    personalNotificationStore.replace(scope, result.preferences)
    if (personalNotificationScope.value === scope) {
      personalNotifications.value = result.preferences.map(preference => ({ ...preference }))
    }
    toast.add({ title: 'Your notification preferences are saved', icon: 'i-lucide-check', color: 'success' })
  } catch (error) {
    toast.add({ title: getErrorMessage(error, 'Could not save your notification preferences'), color: 'error' })
  } finally {
    notificationsSaving.value = false
  }
}

onMounted(loadPersonalNotifications)
watch(personalNotificationScope, () => {
  personalNotifications.value = defaultNotificationPreferences()
  void loadPersonalNotifications()
})

/* canned replies */
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

/* proactive triggers */
interface TriggerRule {
  id: string
  name: string
  url_match: string
  dwell_seconds: number
  message: string
  enabled: boolean
}

const triggerRules = ref<TriggerRule[]>([])
const trigName = ref('')
const trigUrl = ref('')
const trigDwell = ref<number>(30)
const trigMessage = ref('')
const trigSaving = ref(false)

async function loadTriggers() {
  if (!wid.value) return
  triggerRules.value = await $fetch<TriggerRule[]>(`/api/workspaces/${wid.value}/triggers`)
}
onMounted(loadTriggers)
watch(wid, loadTriggers)

async function addTrigger() {
  const name = trigName.value.trim()
  const message = trigMessage.value.trim()
  if (!name || !message || trigSaving.value) return
  trigSaving.value = true
  try {
    const row = await $fetch<TriggerRule>(`/api/workspaces/${wid.value}/triggers`, {
      method: 'POST',
      body: {
        name,
        url_match: trigUrl.value.trim(),
        dwell_seconds: Math.max(3, Math.round(Number(trigDwell.value) || 30)),
        message
      }
    })
    triggerRules.value = [row, ...triggerRules.value]
    trigName.value = ''
    trigUrl.value = ''
    trigDwell.value = 30
    trigMessage.value = ''
    toast.add({ title: `“${row.name}” is live`, icon: 'i-lucide-check', color: 'success' })
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not save the trigger'), color: 'error' })
  } finally {
    trigSaving.value = false
  }
}

async function toggleTrigger(t: TriggerRule, enabled: boolean) {
  const prev = t.enabled
  t.enabled = enabled // optimistic
  try {
    await $fetch(`/api/workspaces/${wid.value}/triggers/${t.id}`, {
      method: 'PATCH',
      body: { enabled }
    })
  } catch (e) {
    t.enabled = prev
    toast.add({ title: getErrorMessage(e, 'Could not update the trigger'), color: 'error' })
  }
}

async function removeTrigger(t: TriggerRule) {
  try {
    await $fetch(`/api/workspaces/${wid.value}/triggers/${t.id}`, { method: 'DELETE' })
    triggerRules.value = triggerRules.value.filter(x => x.id !== t.id)
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
  const workspaceId = wid.value
  if (!workspaceId) return
  try {
    const img = await uploadImage(file, { purpose: 'logo', workspace_id: workspaceId })
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
    <div class="max-w-5xl mx-auto p-5 sm:p-8 space-y-8">
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
                <span class="grid place-items-center size-12 shrink-0 rounded-xl overflow-hidden avatar-primary text-base font-bold">
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
                aria-label="Enable pre-chat form"
                @update:model-value="togglePrechat"
              />
            </div>

            <div
              v-if="workspace?.visitorReplyEmailAvailable"
              class="flex items-center justify-between gap-4"
            >
              <div>
                <p class="text-sm font-medium text-highlighted">
                  Email visitors after they leave
                </p>
                <p class="text-xs text-muted">
                  Sends one private return link after the first teammate reply to each customer message. Message text is never included.
                </p>
              </div>
              <USwitch
                :model-value="workspace?.visitorReplyEmailEnabled"
                :disabled="!isAdmin"
                aria-label="Email visitors after they leave"
                @update:model-value="toggleVisitorReplyEmail"
              />
            </div>
          </div>
        </section>

        <!-- Widget appearance -->
        <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
          <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div>
              <h2 class="font-display font-semibold text-highlighted">
                Widget appearance
              </h2>
              <p class="text-sm text-muted mt-0.5">
                Match the chat experience to your brand without touching the embed code.
              </p>
            </div>
            <UBadge
              color="neutral"
              variant="subtle"
              icon="i-lucide-eye"
              class="mt-2 w-fit sm:mt-0"
            >
              Live preview
            </UBadge>
          </div>

          <div class="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]">
            <WidgetAppearanceEditor
              v-model="widgetEditor"
              :disabled="!isAdmin"
              :saving="savingWidget"
              :remove-branding-allowed="workspace?.entitlement.features.removeBranding"
              @save="saveWidgetCustomization"
            />

            <div class="relative min-h-96 overflow-hidden rounded-2xl bg-grid ring-1 ring-default">
              <div
                class="absolute bottom-4 max-w-[calc(100%-2rem)] overflow-hidden rounded-2xl shadow-xl ring-1 ring-black/10 transition-[width]"
                :class="[
                  widgetEditor.widgetPosition === 'left' ? 'left-4' : 'right-4',
                  previewDark ? 'dark bg-zinc-950 text-white' : 'bg-white text-zinc-950'
                ]"
                :style="{ width: previewWidth }"
              >
                <div class="flex items-center gap-2.5 border-b border-black/10 px-3.5 py-3 dark:border-white/10">
                  <span
                    class="grid size-8 place-items-center overflow-hidden rounded-lg text-xs font-semibold"
                    :style="{ background: `${widgetEditor.widgetPrimaryColor}22`, color: widgetEditor.widgetPrimaryColor }"
                  >
                    <img
                      v-if="workspace?.logoUrl"
                      :src="workspace.logoUrl"
                      alt=""
                      class="size-full object-cover"
                    >
                    <template v-else>{{ (workspace?.name ?? 'P').charAt(0).toUpperCase() }}</template>
                  </span>
                  <div class="min-w-0">
                    <p class="truncate text-xs font-semibold">
                      {{ workspace?.name }}
                    </p>
                    <p class="text-[10px] opacity-60">
                      Online · replies in seconds
                    </p>
                  </div>
                </div>
                <div class="grid min-h-56 place-items-center px-5 text-center">
                  <div>
                    <span
                      class="mx-auto grid size-10 place-items-center rounded-xl"
                      :style="{ background: `${widgetEditor.widgetPrimaryColor}1a`, color: widgetEditor.widgetPrimaryColor }"
                    >
                      <UIcon
                        name="i-lucide-message-circle"
                        class="size-5"
                      />
                    </span>
                    <p class="mt-3 text-sm font-semibold">
                      {{ widgetEditor.widgetGreeting }}
                    </p>
                    <p class="mt-1 text-xs opacity-60">
                      {{ widgetEditor.widgetIntro }}
                    </p>
                  </div>
                </div>
                <div
                  v-if="widgetEditor.widgetShowBranding"
                  class="border-t border-black/10 py-1.5 text-center text-[9px] opacity-50 dark:border-white/10"
                >
                  Powered by Perch
                </div>
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
              aria-label="Enable business hours"
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
                  :aria-label="`${DAY_NAMES[d]} business hours`"
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

        <!-- Personal notifications -->
        <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
          <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div>
              <h2 class="font-display font-semibold text-highlighted">
                Your notifications
              </h2>
              <p class="mt-0.5 text-sm text-muted">
                Personal choices for {{ workspace?.name }}. They do not change anyone else's alerts.
              </p>
            </div>
            <UBadge
              color="neutral"
              variant="subtle"
              class="mt-2 w-fit sm:mt-0"
            >
              Personal
            </UBadge>
          </div>

          <div
            v-if="notificationsLoading"
            class="mt-5 space-y-3"
          >
            <USkeleton
              v-for="n in 3"
              :key="n"
              class="h-24 w-full rounded-xl"
            />
          </div>

          <div
            v-else
            class="mt-5 space-y-3"
          >
            <div
              v-for="item in notificationMeta"
              :key="item.category"
              class="rounded-xl bg-default p-4 ring-1 ring-default"
            >
              <div class="min-w-0">
                <p class="text-sm font-medium text-highlighted">
                  {{ item.title }}
                </p>
                <p class="mt-0.5 text-xs text-muted">
                  {{ item.description }}
                </p>
              </div>
              <div class="mt-4 grid gap-3 sm:grid-cols-3">
                <label class="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-elevated/50 px-3 py-2">
                  <span class="text-sm text-highlighted">In-app pop-up</span>
                  <USwitch
                    v-model="personalPreference(item.category).in_app_enabled"
                    :aria-label="`Show ${item.title.toLowerCase()} as in-app pop-ups`"
                  />
                </label>
                <label class="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-elevated/50 px-3 py-2">
                  <span class="text-sm text-highlighted">Browser</span>
                  <USwitch
                    :model-value="personalPreference(item.category).browser_enabled"
                    :aria-label="`Show ${item.title.toLowerCase()} as browser notifications`"
                    @update:model-value="setBrowserPreference(personalPreference(item.category), $event)"
                  />
                </label>
                <label
                  v-if="item.category === 'unanswered_reminder'"
                  class="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-elevated/50 px-3 py-2"
                >
                  <span class="text-sm text-highlighted">Email</span>
                  <USwitch
                    v-model="personalPreference(item.category).email_enabled"
                    aria-label="Email me unanswered-message reminders"
                  />
                </label>
              </div>
            </div>

            <div class="rounded-xl border border-default px-4 py-3 text-xs text-muted">
              <p>
                Browser alerts appear while Perch is open in a background tab. Your notification bell and inbox response indicators remain available even when pop-ups are off.
              </p>
              <p
                v-if="browserNotifications.permission.value === 'denied'"
                class="mt-2 text-warning"
                role="status"
              >
                Browser notifications are blocked for this site. Allow them in your browser settings to turn them on.
              </p>
              <p
                v-else-if="browserNotifications.permission.value === 'unsupported' || browserNotifications.permission.value === 'insecure'"
                class="mt-2 text-warning"
                role="status"
              >
                Browser notifications are unavailable in this browser or connection.
              </p>
            </div>

            <UButton
              color="neutral"
              :loading="notificationsSaving"
              @click="savePersonalNotifications"
            >
              Save my notifications
            </UButton>
          </div>
        </section>

        <!-- Response target and unanswered-message reminders -->
        <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="font-display font-semibold text-highlighted">
                Response target
              </h2>
              <UBadge
                v-if="!workspace?.entitlement.isPro"
                color="primary"
                variant="subtle"
                size="sm"
              >
                15 min target on Free
              </UBadge>
            </div>
            <p class="mt-0.5 text-sm text-muted">
              Keep waiting conversations visible in the inbox, then optionally email the responsible teammate.
            </p>
          </div>

          <div class="mt-5 grid gap-5 sm:grid-cols-2">
            <UFormField
              label="Reply target"
              :help="workspace?.entitlement.isPro ? 'A conversation becomes overdue after this time.' : 'Upgrade to Pro to customize the target.'"
            >
              <USelect
                v-model="reminderDelay"
                :items="reminderOptions"
                label-key="label"
                value-key="value"
                :disabled="!isAdmin || !workspace?.entitlement.features.customReminderDelay"
                class="w-full"
              />
            </UFormField>
            <div class="flex items-center justify-between gap-4 rounded-xl bg-default px-4 py-3 ring-1 ring-default">
              <div>
                <p class="text-sm font-medium text-highlighted">
                  Email reminders
                </p>
                <p class="text-xs text-muted">
                  Notify the assigned teammate, or admins when unassigned.
                </p>
              </div>
              <USwitch
                v-model="reminderEnabled"
                :disabled="!isAdmin"
                aria-label="Enable unanswered-message email reminders"
              />
            </div>
          </div>

          <div
            v-if="reminderEnabled"
            class="mt-4 flex items-center justify-between gap-4 rounded-xl bg-default px-4 py-3 ring-1 ring-default"
          >
            <div>
              <p class="text-sm font-medium text-highlighted">
                Send emails during business hours only
              </p>
              <p class="text-xs text-muted">
                Email delivery pauses while your team is away. The inbox target timer keeps running.
              </p>
            </div>
            <USwitch
              v-model="reminderBusinessHoursOnly"
              :disabled="!isAdmin || !workspace?.entitlement.features.businessHoursReminders"
              aria-label="Send reminder emails during business hours only"
            />
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-3">
            <UButton
              v-if="isAdmin"
              color="neutral"
              :loading="savingReminder"
              @click="saveReminder"
            >
              Save response settings
            </UButton>
            <NuxtLink
              v-if="!workspace?.entitlement.isPro"
              to="/billing"
              class="text-xs font-medium text-primary-600 hover:underline dark:text-primary-400"
            >
              See Pro features
            </NuxtLink>
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
              <span class="shrink-0 rounded-md bg-primary-500/10 ring-1 ring-primary-500/25 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary-700 dark:text-primary-400">
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

        <!-- Automations -->
        <AutomationSettings
          v-if="isAdmin && wid"
          :workspace-id="wid"
        />

        <!-- Proactive triggers -->
        <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
          <h2 class="font-display font-semibold text-highlighted">
            Proactive triggers
          </h2>
          <p class="text-sm text-muted mt-0.5">
            Reach out first — auto-open the widget with a message when a visitor
            lingers on a page. Each rule fires at most once per visitor.
          </p>

          <ul
            v-if="triggerRules.length"
            class="mt-4 divide-y divide-default/60 rounded-xl ring-1 ring-default overflow-hidden"
          >
            <li
              v-for="t in triggerRules"
              :key="t.id"
              class="group flex items-start gap-3 px-3.5 py-2.5 bg-default"
              :class="{ 'opacity-60': !t.enabled }"
            >
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-highlighted truncate">
                  {{ t.name }}
                </p>
                <p class="text-xs text-dimmed mt-0.5">
                  <span
                    v-if="t.url_match"
                    class="font-mono"
                  >URL contains “{{ t.url_match }}”</span>
                  <span v-else>any page</span>
                  · after {{ t.dwell_seconds }}s
                </p>
                <p class="text-xs text-muted mt-1 line-clamp-2">
                  “{{ t.message }}”
                </p>
              </div>
              <USwitch
                :model-value="t.enabled"
                :disabled="!isAdmin"
                :aria-label="t.enabled ? 'Disable trigger' : 'Enable trigger'"
                @update:model-value="(v: boolean) => toggleTrigger(t, v)"
              />
              <UButton
                v-if="isAdmin"
                class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                size="xs"
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                :aria-label="`Delete ${t.name}`"
                @click="removeTrigger(t)"
              />
            </li>
          </ul>
          <p
            v-else
            class="mt-4 rounded-xl ring-1 ring-default bg-default px-4 py-3 text-xs text-dimmed"
          >
            No triggers yet. Try: URL contains <span class="font-mono">/pricing</span>,
            30 seconds, “Questions about plans? I'm right here.”
          </p>

          <form
            v-if="isAdmin"
            class="mt-4 space-y-2"
            @submit.prevent="addTrigger"
          >
            <div class="flex gap-2">
              <UInput
                v-model="trigName"
                placeholder="Name (e.g. Pricing nudge)"
                size="lg"
                class="w-52"
              />
              <UInput
                v-model="trigUrl"
                placeholder="URL contains… (empty = any page)"
                size="lg"
                class="flex-1 font-mono"
              />
              <UInput
                v-model.number="trigDwell"
                type="number"
                :min="3"
                :max="3600"
                size="lg"
                class="w-24"
                aria-label="Seconds on page before firing"
              >
                <template #trailing>
                  <span class="text-xs text-dimmed">s</span>
                </template>
              </UInput>
            </div>
            <div class="flex gap-2">
              <UInput
                v-model="trigMessage"
                placeholder="The message that pops up…"
                size="lg"
                class="flex-1"
              />
              <UButton
                type="submit"
                color="primary"
                size="lg"
                icon="i-lucide-plus"
                :loading="trigSaving"
                :disabled="!trigName.trim() || !trigMessage.trim()"
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
          <EmbedSnippetCard
            compact
            class="mt-4"
            :snippet="snippet"
          />

          <div class="mt-5">
            <p class="text-sm font-medium text-highlighted">
              Know who you’re talking to <span class="ml-1 rounded-md bg-primary-500/10 ring-1 ring-primary-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-primary-700 dark:text-primary-400">optional</span>
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
              class="text-primary-600 dark:text-primary-400 hover:underline"
            >Admin page</NuxtLink>.
          </p>
        </section>
      </template>
    </div>
  </div>
</template>
