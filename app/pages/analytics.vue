<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Analytics · Perch' })

type AnalyticsRange = '7d' | '30d' | '90d'

interface AnalyticsResponse {
  range: {
    key: AnalyticsRange
    days: number
    start: string
    end: string
    timezone: string
  }
  summary: {
    conversations: number
    resolved: number
    unanswered: number
    missed: number
    averageFirstResponseSeconds: number | null
    averageResolutionSeconds: number | null
    csat: { good: number, bad: number, rated: number, positivePercent: number | null }
  }
  trend: {
    day: string
    conversations: number
    visitorMessages: number
    resolved: number
  }[]
  busiestHours: {
    hour: number
    visitorMessages: number
    conversations: number
  }[]
  team: {
    id: string
    name: string
    role: 'admin' | 'agent'
    openConversations: number
    handledConversations: number
    replies: number
    resolvedConversations: number
    averageFirstResponseSeconds: number | null
    csat: { good: number, bad: number, rated: number, positivePercent: number | null }
  }[]
}

const { currentWorkspace } = useAuth()
const wid = computed(() => currentWorkspace.value?.workspaceId ?? null)
const isAdmin = computed(() => currentWorkspace.value?.role === 'admin')
const range = ref<AnalyticsRange>('30d')
const rangeItems = [
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last 90 days', value: '90d' }
]

const analytics = ref<AnalyticsResponse | null>(null)
const loading = ref(true)
const error = ref(false)
let requestVersion = 0

async function load() {
  if (!wid.value || !isAdmin.value) {
    requestVersion++
    analytics.value = null
    loading.value = false
    error.value = false
    return
  }
  const version = ++requestVersion
  loading.value = true
  error.value = false
  try {
    const result = await $fetch<AnalyticsResponse>(`/api/workspaces/${wid.value}/analytics`, {
      query: { range: range.value }
    })
    if (version === requestVersion) analytics.value = result
  } catch {
    if (version === requestVersion) {
      analytics.value = null
      error.value = true
    }
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

onMounted(load)
watch([wid, range, isAdmin], load)

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) {
    const hours = seconds / 3600
    return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`
  }
  const days = seconds / 86400
  return `${days < 10 ? days.toFixed(1) : Math.round(days)}d`
}

function formatDay(day: string, compact = false): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, compact
    ? { month: 'short', day: 'numeric' }
    : { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatHour(hour: number): string {
  const date = new Date(2026, 0, 1, hour)
  const next = new Date(2026, 0, 1, (hour + 1) % 24)
  const format = (value: Date) => value.toLocaleTimeString(undefined, { hour: 'numeric' })
  return `${format(date)}–${format(next)}`
}

function initials(name: string): string {
  return name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()
}

const maxTrend = computed(() => Math.max(
  1,
  ...(analytics.value?.trend.map(day => Math.max(day.conversations, day.visitorMessages, day.resolved)) ?? [])
))

const maxHourly = computed(() => Math.max(
  1,
  ...(analytics.value?.busiestHours.map(hour => hour.visitorMessages) ?? [])
))

const labelInterval = computed(() => {
  const length = analytics.value?.trend.length ?? 0
  if (length <= 10) return 1
  if (length <= 35) return 5
  return 14
})

const hasActivity = computed(() => analytics.value?.trend.some(day =>
  day.conversations > 0 || day.visitorMessages > 0 || day.resolved > 0
) ?? false)
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-5xl mx-auto p-5 sm:p-8 space-y-6">
      <header
        v-if="isAdmin"
        class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
      >
        <div>
          <h1 class="font-display text-2xl font-bold text-highlighted">
            Support analytics
          </h1>
          <p class="mt-0.5 text-sm text-muted">
            See demand, response quality, and how the team is sharing support.
          </p>
        </div>
        <USelect
          v-model="range"
          :items="rangeItems"
          aria-label="Analytics date range"
          class="w-full sm:w-44"
        />
      </header>

      <div
        v-if="!isAdmin"
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
          Support analytics includes team performance data, so only workspace admins can view it.
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

      <template v-else-if="loading">
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <USkeleton
            v-for="n in 5"
            :key="n"
            class="h-28 rounded-2xl"
          />
        </div>
        <USkeleton class="h-72 rounded-2xl" />
        <div class="grid gap-4 lg:grid-cols-2">
          <USkeleton class="h-72 rounded-2xl" />
          <USkeleton class="h-72 rounded-2xl" />
        </div>
      </template>

      <div
        v-else-if="error"
        class="rounded-2xl border-glow bg-elevated/30 px-6 py-12 text-center"
      >
        <UIcon
          name="i-lucide-cloud-alert"
          class="mx-auto size-8 text-dimmed"
        />
        <h2 class="mt-3 font-display font-semibold text-highlighted">
          Analytics could not load
        </h2>
        <p class="mx-auto mt-1 max-w-md text-sm text-muted">
          Your conversations are safe. Try loading this report again.
        </p>
        <UButton
          class="mt-4"
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          @click="load"
        >
          Try again
        </UButton>
      </div>

      <template v-else-if="analytics">
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <article class="rounded-2xl border-glow bg-elevated/30 p-4 sm:p-5">
            <div class="flex items-center gap-2 text-dimmed">
              <UIcon
                name="i-lucide-messages-square"
                class="size-4"
              />
              <p class="text-[11px] font-medium uppercase tracking-wider">
                Conversations
              </p>
            </div>
            <p class="mt-2 font-display text-2xl font-bold tabular-nums text-highlighted">
              {{ analytics.summary.conversations }}
            </p>
            <p class="mt-1 text-xs text-muted">
              {{ analytics.summary.resolved }} resolved in this period
            </p>
          </article>

          <article class="rounded-2xl border-glow bg-elevated/30 p-4 sm:p-5">
            <div class="flex items-center gap-2 text-dimmed">
              <UIcon
                name="i-lucide-timer"
                class="size-4"
              />
              <p class="text-[11px] font-medium uppercase tracking-wider">
                First response
              </p>
            </div>
            <p class="mt-2 font-display text-2xl font-bold tabular-nums text-highlighted">
              {{ formatDuration(analytics.summary.averageFirstResponseSeconds) }}
            </p>
            <p class="mt-1 text-xs text-muted">
              Average after a visitor writes
            </p>
          </article>

          <article class="rounded-2xl border-glow bg-elevated/30 p-4 sm:p-5">
            <div class="flex items-center gap-2 text-dimmed">
              <UIcon
                name="i-lucide-circle-check-big"
                class="size-4"
              />
              <p class="text-[11px] font-medium uppercase tracking-wider">
                Resolution time
              </p>
            </div>
            <p class="mt-2 font-display text-2xl font-bold tabular-nums text-highlighted">
              {{ formatDuration(analytics.summary.averageResolutionSeconds) }}
            </p>
            <p class="mt-1 text-xs text-muted">
              Average from start to close
            </p>
          </article>

          <article class="rounded-2xl border-glow bg-elevated/30 p-4 sm:p-5">
            <div class="flex items-center gap-2 text-dimmed">
              <UIcon
                name="i-lucide-message-circle-warning"
                class="size-4"
              />
              <p class="text-[11px] font-medium uppercase tracking-wider">
                Unanswered
              </p>
            </div>
            <p class="mt-2 font-display text-2xl font-bold tabular-nums text-highlighted">
              {{ analytics.summary.unanswered }}
            </p>
            <p class="mt-1 text-xs text-muted">
              {{ analytics.summary.missed }} waiting 15+ minutes
            </p>
          </article>

          <article class="col-span-2 rounded-2xl border-glow bg-elevated/30 p-4 sm:p-5 lg:col-span-1">
            <div class="flex items-center gap-2 text-dimmed">
              <UIcon
                name="i-lucide-smile"
                class="size-4"
              />
              <p class="text-[11px] font-medium uppercase tracking-wider">
                CSAT
              </p>
            </div>
            <p class="mt-2 font-display text-2xl font-bold tabular-nums text-highlighted">
              {{ analytics.summary.csat.positivePercent === null ? '—' : `${analytics.summary.csat.positivePercent}%` }}
            </p>
            <p class="mt-1 text-xs text-muted">
              {{ analytics.summary.csat.rated }} rated conversation{{ analytics.summary.csat.rated === 1 ? '' : 's' }}
            </p>
          </article>
        </div>

        <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 class="font-display font-semibold text-highlighted">
                Support volume
              </h2>
              <p class="mt-0.5 text-sm text-muted">
                Daily conversations, incoming messages, and resolutions.
              </p>
            </div>
            <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span class="flex items-center gap-1.5"><span class="size-2 rounded-full bg-primary-500" />Conversations</span>
              <span class="flex items-center gap-1.5"><span class="size-2 rounded-full bg-sky-500" />Visitor messages</span>
              <span class="flex items-center gap-1.5"><span class="size-2 rounded-full bg-emerald-500" />Resolved</span>
            </div>
          </div>

          <div
            v-if="!hasActivity"
            class="mt-5 rounded-xl border border-dashed border-default px-5 py-10 text-center"
          >
            <UIcon
              name="i-lucide-chart-no-axes-column"
              class="mx-auto size-7 text-dimmed"
            />
            <p class="mt-2 text-sm font-medium text-highlighted">
              No conversations in this range
            </p>
            <p class="mt-1 text-xs text-muted">
              New support activity will appear here automatically.
            </p>
          </div>

          <div
            v-else
            class="mt-6 overflow-x-auto pb-1"
          >
            <div
              class="flex h-52 min-w-[680px] items-end gap-1"
              role="img"
              :aria-label="`Daily support volume in ${analytics.range.timezone}`"
            >
              <div
                v-for="(day, index) in analytics.trend"
                :key="day.day"
                class="group flex h-full min-w-2 flex-1 flex-col justify-end"
                :title="`${formatDay(day.day)}: ${day.conversations} conversations, ${day.visitorMessages} visitor messages, ${day.resolved} resolved`"
              >
                <div class="flex h-40 items-end justify-center gap-px">
                  <span
                    class="w-1/3 min-w-0 rounded-t bg-primary-500/85 transition-colors group-hover:bg-primary-500"
                    :style="{ height: `${Math.max(day.conversations ? 3 : 0, (day.conversations / maxTrend) * 100)}%` }"
                  />
                  <span
                    class="w-1/3 min-w-0 rounded-t bg-sky-500/75 transition-colors group-hover:bg-sky-500"
                    :style="{ height: `${Math.max(day.visitorMessages ? 3 : 0, (day.visitorMessages / maxTrend) * 100)}%` }"
                  />
                  <span
                    class="w-1/3 min-w-0 rounded-t bg-emerald-500/75 transition-colors group-hover:bg-emerald-500"
                    :style="{ height: `${Math.max(day.resolved ? 3 : 0, (day.resolved / maxTrend) * 100)}%` }"
                  />
                </div>
                <span class="mt-2 h-7 text-center text-[9px] leading-tight text-dimmed">
                  {{ index % labelInterval === 0 || index === analytics.trend.length - 1 ? formatDay(day.day, true) : '' }}
                </span>
              </div>
            </div>
          </div>
          <p class="mt-2 text-xs text-dimmed">
            Times and day boundaries use {{ analytics.range.timezone }}.
          </p>
        </section>

        <div class="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
            <h2 class="font-display font-semibold text-highlighted">
              Busiest hours
            </h2>
            <p class="mt-0.5 text-sm text-muted">
              When visitors send the most messages.
            </p>

            <div
              v-if="!analytics.busiestHours.length"
              class="mt-5 rounded-xl border border-dashed border-default px-4 py-8 text-center text-sm text-muted"
            >
              No incoming messages in this range.
            </div>
            <ol
              v-else
              class="mt-5 space-y-4"
            >
              <li
                v-for="hour in analytics.busiestHours"
                :key="hour.hour"
                class="space-y-1.5"
              >
                <div class="flex items-center justify-between gap-4 text-xs">
                  <span class="font-medium text-highlighted">{{ formatHour(hour.hour) }}</span>
                  <span class="tabular-nums text-muted">{{ hour.visitorMessages }} message{{ hour.visitorMessages === 1 ? '' : 's' }}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-elevated">
                  <div
                    class="h-full rounded-full bg-sky-500"
                    :style="{ width: `${(hour.visitorMessages / maxHourly) * 100}%` }"
                  />
                </div>
              </li>
            </ol>
          </section>

          <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
            <h2 class="font-display font-semibold text-highlighted">
              Team performance
            </h2>
            <p class="mt-0.5 text-sm text-muted">
              Replies and outcomes during the selected range.
            </p>

            <div
              v-if="!analytics.team.length"
              class="mt-5 text-sm text-muted"
            >
              Invite teammates to see team performance.
            </div>
            <div
              v-else
              class="mt-5 space-y-2"
            >
              <article
                v-for="member in analytics.team"
                :key="member.id"
                class="rounded-xl ring-1 ring-default bg-default p-3.5"
              >
                <div class="flex items-center gap-3">
                  <span class="grid size-9 shrink-0 place-items-center rounded-xl avatar-primary text-xs font-bold">
                    {{ initials(member.name) }}
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-highlighted">
                      {{ member.name }}
                    </p>
                    <p class="text-[11px] capitalize text-dimmed">
                      {{ member.role }} · {{ member.openConversations }} open now
                    </p>
                  </div>
                  <div class="text-right">
                    <p class="text-sm font-semibold tabular-nums text-highlighted">
                      {{ member.handledConversations }}
                    </p>
                    <p class="text-[10px] uppercase tracking-wider text-dimmed">
                      handled
                    </p>
                  </div>
                </div>
                <dl class="mt-3 grid grid-cols-4 gap-2 border-t border-default/70 pt-3 text-center">
                  <div>
                    <dt class="text-[10px] uppercase tracking-wide text-dimmed">
                      Replies
                    </dt>
                    <dd class="mt-0.5 text-sm tabular-nums text-highlighted">
                      {{ member.replies }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-[10px] uppercase tracking-wide text-dimmed">
                      Resolved
                    </dt>
                    <dd class="mt-0.5 text-sm tabular-nums text-highlighted">
                      {{ member.resolvedConversations }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-[10px] uppercase tracking-wide text-dimmed">
                      Response
                    </dt>
                    <dd class="mt-0.5 text-sm tabular-nums text-highlighted">
                      {{ formatDuration(member.averageFirstResponseSeconds) }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-[10px] uppercase tracking-wide text-dimmed">
                      CSAT
                    </dt>
                    <dd class="mt-0.5 text-sm tabular-nums text-highlighted">
                      {{ member.csat.positivePercent === null ? '—' : `${member.csat.positivePercent}%` }}
                    </dd>
                  </div>
                </dl>
              </article>
            </div>
          </section>
        </div>

        <details class="rounded-xl border-glow bg-elevated/20 px-4 py-3 text-xs text-muted">
          <summary class="cursor-pointer font-medium text-highlighted">
            How these numbers are calculated
          </summary>
          <p class="mt-2 leading-relaxed">
            First response runs from a visitor's first message to the first public agent reply. Resolution time runs from conversation creation to resolution. Unanswered means no public agent reply; missed means it is still unresolved after 15 minutes. Internal notes are excluded.
          </p>
        </details>
      </template>
    </div>
  </div>
</template>
