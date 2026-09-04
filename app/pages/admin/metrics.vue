<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Metrics · Perch' })

interface Metrics {
  totals: { users: string, workspaces: string, conversations: string, messages: string }
  last_7d: { new_users_7d: string, active_workspaces_7d: string, new_conversations_7d: string, messages_7d: string }
  daily: { day: string, signups: string, messages: string }[]
  billing: {
    reconciliation: Array<{ workspaceId: string, workspaceName: string, attempts: number, error: string | null, correlationId: string | null, updatedAt: string }>
    webhooks: Array<{ eventType: string, attempts: number, error: string | null, updatedAt: string }>
    financialConflicts: Array<{ id: string, workspaceId: string, workspaceName: string, conflictingSubscriptionId: string, canonicalSubscriptionId: string | null, invoiceReference: string | null, amountCents: number | null, currency: string | null, providerChargeId: string | null, attempts: number, error: string | null, correlationId: string | null, updatedAt: string }>
  }
  attachment_cleanup: {
    outstanding: string
    failed: string
    oldest_outstanding_at: string | null
  }
}

interface AttachmentCleanupRow {
  id: string
  state: 'processing' | 'retrying' | 'dead_letter'
  kind: 'message' | 'logo'
  reason: string | null
  attempts: number
  nextAttemptAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

const metrics = ref<Metrics | null>(null)
const denied = ref(false)
const loading = ref(true)
const cleanupRows = ref<AttachmentCleanupRow[]>([])
const cleanupLoading = ref(false)
const cleanupError = ref<string | null>(null)
const retryingCleanupId = ref<string | null>(null)
const toast = useToast()

async function loadAttachmentCleanup() {
  cleanupLoading.value = true
  cleanupError.value = null
  try {
    cleanupRows.value = await $fetch<AttachmentCleanupRow[]>('/api/admin/attachment-cleanup')
  } catch (error) {
    cleanupError.value = getErrorMessage(error, 'Could not load the attachment cleanup queue')
  } finally {
    cleanupLoading.value = false
  }
}

async function loadPage() {
  loading.value = true
  denied.value = false
  try {
    metrics.value = await $fetch<Metrics>('/api/admin/metrics')
    await loadAttachmentCleanup()
  } catch {
    denied.value = true
  } finally {
    loading.value = false
  }
}

onMounted(loadPage)

const cards = computed(() => {
  if (!metrics.value) return []
  const t = metrics.value.totals
  const w = metrics.value.last_7d
  return [
    { label: 'Users', value: t.users, sub: `+${w.new_users_7d} this week`, icon: 'i-lucide-users' },
    { label: 'Workspaces', value: t.workspaces, sub: `${w.active_workspaces_7d} active this week`, icon: 'i-lucide-building-2' },
    { label: 'Conversations', value: t.conversations, sub: `+${w.new_conversations_7d} this week`, icon: 'i-lucide-messages-square' },
    { label: 'Messages', value: t.messages, sub: `+${w.messages_7d} this week`, icon: 'i-lucide-message-circle' }
  ]
})

const maxDaily = computed(() =>
  Math.max(1, ...(metrics.value?.daily ?? []).map(d => Number(d.messages)))
)

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function cleanupStateLabel(state: AttachmentCleanupRow['state']) {
  return ({
    processing: 'Deleting now',
    retrying: 'Retry scheduled',
    dead_letter: 'Needs manual retry'
  })[state]
}

function cleanupReasonLabel(reason: string | null) {
  if (!reason) return 'Abandoned upload'
  return ({
    abandoned_upload: 'Abandoned upload',
    attachment_replaced: 'Replaced attachment',
    workspace_deleted: 'Deleted workspace',
    account_deleted: 'Deleted account'
  } as Record<string, string>)[reason] ?? reason.replaceAll('_', ' ')
}

function cleanupErrorLabel(value: string | null) {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return [parsed.type, parsed.code, parsed.statusCode]
      .filter(item => typeof item === 'string' || typeof item === 'number')
      .join(' · ') || 'Provider cleanup failed'
  } catch {
    return 'Provider cleanup failed'
  }
}

function cleanupWhen(value: string | null) {
  if (!value) return 'Not scheduled'
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

async function retryAttachmentCleanup(row: AttachmentCleanupRow) {
  if (row.state !== 'dead_letter' || retryingCleanupId.value) return
  retryingCleanupId.value = row.id
  try {
    await $fetch(`/api/admin/attachment-cleanup/${row.id}/retry`, { method: 'POST' })
  } catch (error) {
    toast.add({ title: getErrorMessage(error, 'Could not retry attachment cleanup'), color: 'error' })
    await loadAttachmentCleanup()
    retryingCleanupId.value = null
    return
  }

  toast.add({ title: 'Attachment cleanup queued again', color: 'success' })
  await loadAttachmentCleanup()
  try {
    metrics.value = await $fetch<Metrics>('/api/admin/metrics')
  } catch {
    toast.add({ title: 'Cleanup was queued, but the summary could not refresh', color: 'warning' })
  } finally {
    retryingCleanupId.value = null
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-3xl mx-auto p-5 sm:p-8 space-y-8">
      <h1 class="font-display text-2xl font-bold text-highlighted">
        Instance metrics
      </h1>

      <div
        v-if="loading"
        class="grid grid-cols-2 lg:grid-cols-4 gap-3"
      >
        <USkeleton
          v-for="n in 4"
          :key="n"
          class="h-24 rounded-2xl"
        />
      </div>

      <div
        v-else-if="denied"
        class="rounded-2xl border-glow bg-elevated/30 p-8 text-center"
      >
        <UIcon
          name="i-lucide-lock"
          class="mx-auto size-7 text-dimmed"
        />
        <p class="mt-3 text-sm text-muted">
          This page is for the instance operator. Add your email to
          <code class="font-mono text-xs">PERCH_ADMIN_EMAILS</code> to enable it.
        </p>
      </div>

      <template v-else-if="metrics">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div
            v-for="c in cards"
            :key="c.label"
            class="rounded-2xl border-glow bg-elevated/30 p-4"
          >
            <div class="flex items-center gap-2 text-dimmed">
              <UIcon
                :name="c.icon"
                class="size-4"
              />
              <span class="text-xs font-medium uppercase tracking-wider">{{ c.label }}</span>
            </div>
            <p class="mt-2 font-display text-2xl font-bold text-highlighted">
              {{ c.value }}
            </p>
            <p class="text-xs text-muted mt-0.5">
              {{ c.sub }}
            </p>
          </div>
        </div>

        <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 class="font-display font-semibold text-highlighted">
                Attachment cleanup
              </h2>
              <p class="mt-0.5 text-sm text-muted">
                Perch removes abandoned and replaced uploads automatically. Only exhausted jobs need manual action.
              </p>
            </div>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-refresh-cw"
              :loading="cleanupLoading"
              @click="loadAttachmentCleanup"
            >
              Refresh
            </UButton>
          </div>

          <div class="mt-4 grid gap-3 sm:grid-cols-3">
            <div class="rounded-xl bg-default p-3 ring-1 ring-default">
              <p class="text-xs font-medium uppercase tracking-wider text-dimmed">
                Outstanding
              </p>
              <p class="mt-1 font-display text-xl font-bold text-highlighted">
                {{ metrics.attachment_cleanup.outstanding }}
              </p>
            </div>
            <div
              class="rounded-xl p-3 ring-1"
              :class="Number(metrics.attachment_cleanup.failed) > 0 ? 'bg-error/10 ring-error/20' : 'bg-default ring-default'"
            >
              <p class="text-xs font-medium uppercase tracking-wider text-dimmed">
                Needs attention
              </p>
              <p
                class="mt-1 font-display text-xl font-bold"
                :class="Number(metrics.attachment_cleanup.failed) > 0 ? 'text-error' : 'text-highlighted'"
              >
                {{ metrics.attachment_cleanup.failed }}
              </p>
            </div>
            <div class="rounded-xl bg-default p-3 ring-1 ring-default">
              <p class="text-xs font-medium uppercase tracking-wider text-dimmed">
                Oldest outstanding
              </p>
              <p class="mt-1 text-sm font-medium text-highlighted">
                {{ cleanupWhen(metrics.attachment_cleanup.oldest_outstanding_at) }}
              </p>
            </div>
          </div>

          <div
            v-if="cleanupLoading && !cleanupRows.length"
            class="mt-4 space-y-2"
            aria-label="Loading attachment cleanup queue"
          >
            <USkeleton
              v-for="index in 2"
              :key="index"
              class="h-20 rounded-xl"
            />
          </div>
          <div
            v-else-if="cleanupError"
            class="mt-4 flex flex-col items-start gap-3 rounded-xl bg-error/10 p-4 ring-1 ring-error/20 sm:flex-row sm:items-center"
            role="alert"
          >
            <p class="min-w-0 flex-1 text-sm text-error">
              {{ cleanupError }}
            </p>
            <UButton
              color="neutral"
              variant="soft"
              size="sm"
              icon="i-lucide-refresh-cw"
              @click="loadAttachmentCleanup"
            >
              Try again
            </UButton>
          </div>
          <div
            v-else-if="!cleanupRows.length"
            class="mt-4 rounded-xl bg-success/10 p-4 text-sm text-success"
          >
            No attachment cleanup jobs need operator attention.
          </div>
          <ul
            v-else
            class="mt-4 space-y-3"
            aria-label="Attachment cleanup queue"
          >
            <li
              v-for="row in cleanupRows"
              :key="row.id"
              class="rounded-xl bg-default p-4 ring-1 ring-default"
            >
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-sm font-medium capitalize text-highlighted">{{ row.kind }} attachment</span>
                    <span
                      class="rounded-full px-2 py-0.5 text-xs font-medium"
                      :class="{
                        'bg-error/10 text-error': row.state === 'dead_letter',
                        'bg-warning/10 text-warning': row.state === 'retrying',
                        'bg-info/10 text-info': row.state === 'processing'
                      }"
                    >
                      {{ cleanupStateLabel(row.state) }}
                    </span>
                  </div>
                  <p class="mt-1 text-xs text-muted">
                    {{ cleanupReasonLabel(row.reason) }} · attempt {{ row.attempts }}
                  </p>
                  <p class="mt-1 text-xs text-dimmed">
                    {{ row.nextAttemptAt ? `Next try ${cleanupWhen(row.nextAttemptAt)}` : `Updated ${cleanupWhen(row.updatedAt)}` }}
                  </p>
                  <p
                    v-if="cleanupErrorLabel(row.lastError)"
                    class="mt-1 break-words font-mono text-xs text-error"
                  >
                    {{ cleanupErrorLabel(row.lastError) }}
                  </p>
                </div>
                <UButton
                  v-if="row.state === 'dead_letter'"
                  color="neutral"
                  variant="soft"
                  size="sm"
                  icon="i-lucide-rotate-cw"
                  :loading="retryingCleanupId === row.id"
                  :disabled="Boolean(retryingCleanupId)"
                  @click="retryAttachmentCleanup(row)"
                >
                  Retry now
                </UButton>
              </div>
            </li>
          </ul>
          <p class="mt-3 text-xs text-dimmed">
            Recent unclaimed uploads are retained for 24 hours before automatic cleanup, so the outstanding total may be higher than this action queue.
          </p>
        </section>

        <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
          <h2 class="font-display font-semibold text-highlighted">
            Last 14 days
          </h2>
          <p class="text-sm text-muted mt-0.5">
            Messages per day, with signups underneath.
          </p>
          <div class="mt-5 flex items-end gap-1.5 h-32">
            <div
              v-for="d in metrics.daily"
              :key="d.day"
              class="flex-1 flex flex-col items-center gap-1 group"
              :title="`${dayLabel(d.day)} — ${d.messages} messages, ${d.signups} signups`"
            >
              <div
                class="w-full rounded-t bg-primary-500/70 group-hover:bg-primary-500 transition-colors"
                :style="{ height: `${Math.max(2, (Number(d.messages) / maxDaily) * 100)}%` }"
              />
            </div>
          </div>
          <div class="mt-2 flex justify-between text-[10px] text-dimmed font-mono">
            <span>{{ dayLabel(metrics.daily[0]?.day ?? '') }}</span>
            <span>{{ dayLabel(metrics.daily[metrics.daily.length - 1]?.day ?? '') }}</span>
          </div>
          <div class="mt-4 grid grid-cols-7 sm:grid-cols-14 gap-1.5 text-center">
            <span
              v-for="d in metrics.daily"
              :key="d.day"
              class="text-[10px] font-mono"
              :class="Number(d.signups) > 0 ? 'text-primary-600 dark:text-primary-400 font-semibold' : 'text-dimmed'"
            >{{ d.signups }}</span>
          </div>
          <p class="mt-1 text-center text-[10px] uppercase tracking-wider text-dimmed">
            signups / day
          </p>
        </section>

        <section class="rounded-2xl border-glow bg-elevated/30 p-5 sm:p-6">
          <h2 class="font-display font-semibold text-highlighted">
            Billing attention queue
          </h2>
          <p class="mt-0.5 text-sm text-muted">
            Failed reconciliation, failed signed webhooks, and duplicate subscriptions requiring verified cancellation or refund review.
          </p>
          <div
            v-if="!metrics.billing.financialConflicts.length && !metrics.billing.reconciliation.length && !metrics.billing.webhooks.length"
            class="mt-4 rounded-xl bg-success/10 p-4 text-sm text-success"
          >
            No billing failures need operator attention.
          </div>
          <div class="mt-4 space-y-3">
            <div
              v-for="row in metrics.billing.financialConflicts"
              :key="row.id"
              class="rounded-xl bg-error/10 p-4 ring-1 ring-error/20"
            >
              <p class="font-medium text-highlighted">
                Duplicate subscription · {{ row.workspaceName }}
              </p>
              <p class="mt-1 break-all font-mono text-xs text-muted">
                conflicting {{ row.conflictingSubscriptionId }} · canonical {{ row.canonicalSubscriptionId ?? 'unknown' }}
              </p>
              <p class="mt-1 text-xs text-muted">
                {{ row.error }} · attempts {{ row.attempts }} · correlation {{ row.correlationId ?? 'unavailable' }}
              </p>
            </div>
            <div
              v-for="row in metrics.billing.reconciliation"
              :key="`reconciliation-${row.workspaceId}`"
              class="rounded-xl bg-warning/10 p-4 ring-1 ring-warning/20"
            >
              <p class="font-medium text-highlighted">
                Reconciliation failed · {{ row.workspaceName }}
              </p>
              <p class="mt-1 text-xs text-muted">
                {{ row.error }} · attempts {{ row.attempts }} · correlation {{ row.correlationId ?? 'unavailable' }}
              </p>
            </div>
            <div
              v-for="(row, index) in metrics.billing.webhooks"
              :key="`billing-webhook-${index}`"
              class="rounded-xl bg-warning/10 p-4 ring-1 ring-warning/20"
            >
              <p class="font-medium text-highlighted">
                Signed billing webhook failed · {{ row.eventType }}
              </p>
              <p class="mt-1 text-xs text-muted">
                {{ row.error }} · attempts {{ row.attempts }}
              </p>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
