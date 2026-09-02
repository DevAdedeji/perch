<script setup lang="ts">
import type { BillingInterval } from '@perch/shared'

definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Plans & billing · Perch' })

interface BillingOverview {
  checkoutEnabled: boolean
  providerConfigured: boolean
  hasBillingHistory: boolean
  needsProviderSubscription: boolean
  reconciliation: {
    status: 'pending' | 'processing' | 'retrying' | 'idle' | 'failed'
    lastCheckedAt: string | null
    nextAttemptAt: string | null
    needsAttention: boolean
  } | null
  entitlement: {
    plan: 'free' | 'pro'
    isPro: boolean
    status: string | null
    interval: BillingInterval | null
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    providerSubscriptionConnected: boolean
  }
  invoices: Array<{
    id: string
    reference: string
    status: 'pending' | 'paid' | 'failed'
    interval: BillingInterval
    amountCents: number
    currency: string
    paidAt: string | null
    createdAt: string
  }>
}

interface BillingRefreshResult {
  checkedAt: string
  invoicesChecked: number
  invoicesChanged: number
  subscriptionChecked: boolean
  awaitingSubscription: boolean
  providerResourcesChecked: number
  providerRequestCap: number
  nextCheckAt: string | null
  overview: BillingOverview
}

const { currentWorkspace } = useAuth()
const route = useRoute()
const toast = useToast()
const workspaceId = computed(() => currentWorkspace.value?.workspaceId ?? null)
const isAdmin = computed(() => currentWorkspace.value?.role === 'admin')
const overview = ref<BillingOverview | null>(null)
const loading = ref(true)
const loadError = ref('')
const checkoutInterval = ref<BillingInterval>('yearly')
const displayedInterval = computed<BillingInterval>(() => {
  if (overview.value?.entitlement.isPro && overview.value.entitlement.interval) {
    return overview.value.entitlement.interval
  }
  return checkoutInterval.value
})
const checkingOut = ref(false)
const canceling = ref(false)
const refreshingProvider = ref(false)
const lastProviderCheck = ref<string | null>(null)
let paymentPollSequence = 0
let loadSequence = 0

async function load(options: { silent?: boolean } = {}) {
  const requestedWorkspaceId = workspaceId.value
  if (!requestedWorkspaceId || !isAdmin.value) return false
  const sequence = ++loadSequence
  if (!options.silent) loading.value = true
  try {
    const result = await $fetch<BillingOverview>(`/api/workspaces/${requestedWorkspaceId}/billing`)
    if (sequence !== loadSequence || workspaceId.value !== requestedWorkspaceId) return false
    overview.value = result
    lastProviderCheck.value = result.reconciliation?.lastCheckedAt ?? null
    loadError.value = ''
    return true
  } catch (error) {
    if (sequence === loadSequence) loadError.value = getErrorMessage(error, 'Plans and billing could not load')
    return false
  } finally {
    if (!options.silent && sequence === loadSequence) loading.value = false
  }
}

onMounted(() => {
  if (!isAdmin.value) {
    navigateTo('/dashboard')
    return
  }
  if (route.query.paid === '1') {
    toast.add({
      title: 'Checking your payment',
      description: 'You returned from checkout. Pro activates only after the payment is confirmed.',
      color: 'info',
      icon: 'i-lucide-loader-circle'
    })
    checkPaymentAfterReturn(++paymentPollSequence)
  } else {
    load()
  }
})
watch(workspaceId, () => {
  paymentPollSequence++
  overview.value = null
  loadError.value = ''
  if (isAdmin.value) load()
})
async function checkPaymentAfterReturn(pollSequence: number) {
  const loaded = await refreshProvider({ notify: false })
  if (pollSequence !== paymentPollSequence) return
  if (loaded && overview.value?.entitlement.isPro) {
    toast.add({
      title: 'Pro is active',
      description: 'Bachs confirmed the payment and subscription period.',
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    return
  }
  toast.add({
    title: loaded ? 'Payment is still being verified' : 'Payment status could not be refreshed',
    description: loaded
      ? 'Perch will keep checking safely in the background. Pro activates only after payment confirmation.'
      : 'Your payment was not marked as failed. You can safely retry from this page.',
    color: 'neutral',
    icon: 'i-lucide-clock'
  })
}

async function refreshProvider(options: { silent?: boolean, notify?: boolean } = {}) {
  const requestedWorkspaceId = workspaceId.value
  if (!requestedWorkspaceId || !isAdmin.value || refreshingProvider.value) return false
  refreshingProvider.value = true
  if (!options.silent) loading.value = !overview.value
  try {
    const result = await $fetch<BillingRefreshResult>(`/api/workspaces/${requestedWorkspaceId}/billing/refresh`, {
      method: 'POST'
    })
    if (workspaceId.value !== requestedWorkspaceId) return false
    if (result.providerResourcesChecked === 0) {
      throw new Error('No Bachs checkout or subscription was available to verify.')
    }
    overview.value = result.overview
    lastProviderCheck.value = result.checkedAt
    loadError.value = ''
    if (options.notify !== false) {
      toast.add({
        title: result.awaitingSubscription ? 'Payment details checked' : 'Billing status is up to date',
        description: result.awaitingSubscription
          ? 'The checkout is paid, but Bachs has not linked a subscription yet. Pro stays off until the matching subscription event arrives.'
          : `Verified ${result.providerResourcesChecked} billing record${result.providerResourcesChecked === 1 ? '' : 's'} directly with Bachs.`,
        color: result.awaitingSubscription ? 'warning' : 'success',
        icon: result.awaitingSubscription ? 'i-lucide-clock' : 'i-lucide-circle-check'
      })
    }
    return true
  } catch (error) {
    if (workspaceId.value === requestedWorkspaceId) {
      loadError.value = getErrorMessage(error, 'Payment status could not be refreshed')
    }
    if (options.notify !== false) {
      toast.add({ title: loadError.value, description: 'Nothing was changed. You can safely retry.', color: 'error' })
    }
    return false
  } finally {
    refreshingProvider.value = false
    if (!options.silent) loading.value = false
  }
}

async function startCheckout() {
  if (!workspaceId.value || checkingOut.value || !isAdmin.value) return
  checkingOut.value = true
  try {
    const result = await $fetch<{ checkoutUrl: string }>(`/api/workspaces/${workspaceId.value}/billing/checkout`, {
      method: 'POST',
      body: { interval: checkoutInterval.value, requestId: crypto.randomUUID() }
    })
    window.location.assign(result.checkoutUrl)
  } catch (error) {
    toast.add({ title: getErrorMessage(error, 'Could not open checkout'), color: 'error' })
  } finally {
    checkingOut.value = false
  }
}

async function cancelPlan() {
  if (!workspaceId.value || canceling.value || !isAdmin.value) return
  if (!window.confirm('Cancel renewal? Pro will remain active until the confirmed paid period ends.')) return
  canceling.value = true
  try {
    await $fetch(`/api/workspaces/${workspaceId.value}/billing/cancel`, { method: 'POST' })
    toast.add({
      title: 'Renewal canceled',
      description: 'Pro stays active until the end of the paid period.',
      color: 'success'
    })
    await load()
  } catch (error) {
    toast.add({ title: getErrorMessage(error, 'Could not cancel the plan'), color: 'error' })
  } finally {
    canceling.value = false
  }
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

function date(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto max-w-5xl space-y-6 p-5 sm:p-8">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 class="font-display text-2xl font-bold text-highlighted">
            Plans & billing
          </h1>
          <p class="mt-1 text-sm text-muted">
            One workspace plan covers everyone on your support team.
          </p>
        </div>
        <div
          v-if="overview?.hasBillingHistory"
          class="flex flex-col items-start gap-1 sm:items-end"
        >
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-refresh-cw"
            :loading="refreshingProvider"
            :disabled="!overview.providerConfigured"
            @click="refreshProvider()"
          >
            Check Bachs status
          </UButton>
          <p
            v-if="lastProviderCheck"
            class="text-xs text-muted"
          >
            Last checked {{ new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(lastProviderCheck)) }}
          </p>
        </div>
      </div>

      <USkeleton
        v-if="loading"
        class="h-96 w-full rounded-2xl"
      />

      <div
        v-else-if="loadError && !overview"
        class="rounded-2xl bg-elevated/30 px-6 py-12 text-center ring-1 ring-default"
        role="alert"
      >
        <UIcon
          name="i-lucide-cloud-alert"
          class="mx-auto size-8 text-dimmed"
        />
        <h2 class="mt-3 font-display text-lg font-semibold text-highlighted">
          Plans and billing could not load
        </h2>
        <p class="mx-auto mt-1 max-w-md text-sm text-muted">
          {{ loadError }} Nothing was changed.
        </p>
        <UButton
          class="mt-4"
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          @click="load()"
        >
          Try again
        </UButton>
      </div>

      <template v-else-if="overview">
        <UAlert
          v-if="overview.reconciliation?.needsAttention"
          color="error"
          variant="subtle"
          title="Automatic billing checks need attention"
          description="Perch stopped retrying after repeated provider failures. An admin can check Bachs again safely; Pro access still follows the last confirmed paid period and cannot extend indefinitely."
          icon="i-lucide-triangle-alert"
        />
        <UAlert
          v-if="overview.needsProviderSubscription"
          color="warning"
          variant="subtle"
          title="Waiting for subscription confirmation"
          description="Bachs confirmed the checkout payment, but no matching subscription is connected yet. Pro remains off until Bachs sends that subscription record; checking again can verify the checkout but cannot invent a missing subscription."
          icon="i-lucide-clock"
        />
        <UAlert
          v-if="loadError"
          color="warning"
          variant="subtle"
          title="Payment status could not be refreshed"
          :description="`${loadError} The last confirmed billing details are shown below.`"
          icon="i-lucide-cloud-alert"
        >
          <template #actions>
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              @click="load()"
            >
              Retry
            </UButton>
          </template>
        </UAlert>
        <div class="grid gap-5 lg:grid-cols-2">
          <section
            class="rounded-2xl bg-elevated/30 p-6 ring-1"
            :class="overview.entitlement.plan === 'free' ? 'ring-primary-500/60' : 'ring-default'"
          >
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-sm font-medium text-muted">
                  Free
                </p>
                <p class="mt-2 font-display text-4xl font-bold text-highlighted">
                  $0
                </p>
                <p class="mt-1 text-sm text-muted">
                  Forever
                </p>
              </div>
              <UBadge
                v-if="overview.entitlement.plan === 'free'"
                color="primary"
              >
                Current plan
              </UBadge>
            </div>
            <ul class="mt-6 space-y-3 text-sm text-muted">
              <li class="flex gap-2">
                <UIcon
                  name="i-lucide-check"
                  class="mt-0.5 size-4 text-primary-500"
                />Unlimited conversations
              </li>
              <li class="flex gap-2">
                <UIcon
                  name="i-lucide-check"
                  class="mt-0.5 size-4 text-primary-500"
                />2 teammates
              </li>
              <li class="flex gap-2">
                <UIcon
                  name="i-lucide-check"
                  class="mt-0.5 size-4 text-primary-500"
                />15-minute unanswered-message reminders
              </li>
              <li class="flex gap-2">
                <UIcon
                  name="i-lucide-check"
                  class="mt-0.5 size-4 text-primary-500"
                />Inbox, Nest, help center and core automations
              </li>
            </ul>
          </section>

          <section
            class="rounded-2xl bg-elevated/30 p-6 ring-1"
            :class="overview.entitlement.isPro ? 'ring-primary-500/60' : 'ring-default'"
          >
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-sm font-medium text-primary-600 dark:text-primary-400">
                  Pro
                </p>
                <p class="mt-2 font-display text-4xl font-bold text-highlighted">
                  {{ displayedInterval === 'yearly' ? '$90' : '$9' }}
                </p>
                <p class="mt-1 text-sm text-muted">
                  per workspace / {{ displayedInterval === 'yearly' ? 'year' : 'month' }}
                </p>
              </div>
              <UBadge
                v-if="overview.entitlement.isPro"
                color="primary"
              >
                Current plan
              </UBadge>
            </div>

            <div
              v-if="!overview.entitlement.isPro"
              class="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-elevated p-1 ring-1 ring-default"
            >
              <button
                v-for="option in ([{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly · save $18' }] as const)"
                :key="option.value"
                type="button"
                class="rounded-lg px-3 py-2 text-xs font-medium transition-colors"
                :class="checkoutInterval === option.value ? 'bg-default text-highlighted shadow-sm' : 'text-muted hover:text-highlighted'"
                :aria-pressed="checkoutInterval === option.value"
                @click="checkoutInterval = option.value"
              >
                {{ option.label }}
              </button>
            </div>

            <ul class="mt-6 space-y-3 text-sm text-muted">
              <li class="flex gap-2">
                <UIcon
                  name="i-lucide-check"
                  class="mt-0.5 size-4 text-primary-500"
                />Everything in Free
              </li>
              <li class="flex gap-2">
                <UIcon
                  name="i-lucide-check"
                  class="mt-0.5 size-4 text-primary-500"
                />Unlimited teammates
              </li>
              <li class="flex gap-2">
                <UIcon
                  name="i-lucide-check"
                  class="mt-0.5 size-4 text-primary-500"
                />Custom reminder timing and business-hours delivery
              </li>
              <li class="flex gap-2">
                <UIcon
                  name="i-lucide-check"
                  class="mt-0.5 size-4 text-primary-500"
                />Remove “Powered by Perch” branding
              </li>
            </ul>

            <UButton
              v-if="!overview.entitlement.isPro && isAdmin"
              block
              class="mt-6"
              :loading="checkingOut"
              :disabled="!overview.checkoutEnabled"
              @click="startCheckout"
            >
              Upgrade to Pro
            </UButton>
            <p
              v-if="!overview.checkoutEnabled && !overview.entitlement.isPro"
              class="mt-2 text-center text-xs text-muted"
            >
              Pro upgrades are not open yet. Your workspace will stay on Free until checkout launches.
            </p>
            <div
              v-if="overview.entitlement.isPro"
              class="mt-6 rounded-xl bg-default p-4 ring-1 ring-default"
            >
              <p class="text-sm font-medium text-highlighted">
                {{ overview.entitlement.cancelAtPeriodEnd || overview.entitlement.status === 'canceled'
                  ? 'Ends at the close of this paid period'
                  : overview.entitlement.status === 'past_due'
                    ? 'Payment needs attention'
                    : 'Subscription active' }}
              </p>
              <p
                v-if="overview.entitlement.currentPeriodEnd"
                class="mt-1 text-xs text-muted"
              >
                {{ overview.entitlement.cancelAtPeriodEnd || overview.entitlement.status === 'canceled' || overview.entitlement.status === 'past_due'
                  ? 'Access until'
                  : 'Current paid period ends' }} {{ date(overview.entitlement.currentPeriodEnd) }}
              </p>
              <UButton
                v-if="isAdmin && !overview.entitlement.cancelAtPeriodEnd"
                class="mt-3"
                size="sm"
                color="neutral"
                variant="subtle"
                :loading="canceling"
                @click="cancelPlan"
              >
                Cancel renewal
              </UButton>
            </div>
          </section>
        </div>

        <section class="rounded-2xl bg-elevated/30 p-5 ring-1 ring-default sm:p-6">
          <h2 class="font-display font-semibold text-highlighted">
            Checkout history
          </h2>
          <p
            v-if="!overview.invoices.length"
            class="mt-4 rounded-xl bg-default px-4 py-6 text-center text-sm text-muted ring-1 ring-default"
          >
            No checkout attempts yet.
          </p>
          <div
            v-else
            class="mt-4 overflow-x-auto rounded-xl ring-1 ring-default"
          >
            <table class="w-full min-w-[540px] text-left text-sm">
              <thead class="bg-elevated text-xs text-muted">
                <tr>
                  <th class="px-4 py-3">
                    Date
                  </th><th class="px-4 py-3">
                    Plan
                  </th><th class="px-4 py-3">
                    Amount
                  </th><th class="px-4 py-3">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default bg-default">
                <tr
                  v-for="invoice in overview.invoices"
                  :key="invoice.id"
                >
                  <td class="px-4 py-3 text-muted">
                    {{ date(invoice.createdAt) }}
                  </td>
                  <td class="px-4 py-3 capitalize text-highlighted">
                    Pro · {{ invoice.interval }}
                  </td>
                  <td class="px-4 py-3 text-highlighted">
                    {{ money(invoice.amountCents, invoice.currency) }}
                  </td>
                  <td class="px-4 py-3">
                    <UBadge
                      color="neutral"
                      variant="subtle"
                      class="capitalize"
                    >
                      {{ invoice.status }}
                    </UBadge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
