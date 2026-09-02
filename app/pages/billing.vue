<script setup lang="ts">
import type { BillingInterval } from '@perch/shared'

definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Plans & billing · Perch' })

interface BillingOverview {
  configured: boolean
  entitlement: {
    plan: 'free' | 'pro'
    isPro: boolean
    status: string | null
    interval: BillingInterval | null
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
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

const { currentWorkspace } = useAuth()
const route = useRoute()
const toast = useToast()
const workspaceId = computed(() => currentWorkspace.value?.workspaceId ?? null)
const isAdmin = computed(() => currentWorkspace.value?.role === 'admin')
const overview = ref<BillingOverview | null>(null)
const loading = ref(true)
const checkoutInterval = ref<BillingInterval>('yearly')
const displayedInterval = computed<BillingInterval>(() => {
  if (overview.value?.entitlement.isPro && overview.value.entitlement.interval) {
    return overview.value.entitlement.interval
  }
  return checkoutInterval.value
})
const checkingOut = ref(false)
const canceling = ref(false)
let paymentPoll: ReturnType<typeof setTimeout> | undefined

async function load() {
  if (!workspaceId.value || !isAdmin.value) return
  loading.value = true
  try {
    overview.value = await $fetch<BillingOverview>(`/api/workspaces/${workspaceId.value}/billing`)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (!isAdmin.value) {
    navigateTo('/dashboard')
    return
  }
  if (route.query.paid === '1') {
    toast.add({
      title: 'Checkout completed',
      description: 'We are securely confirming the payment with Bachs. This can take a moment.',
      color: 'info',
      icon: 'i-lucide-loader-circle'
    })
    pollForPaymentConfirmation()
  } else {
    load()
  }
})
watch(workspaceId, () => {
  if (isAdmin.value) load()
})
onBeforeUnmount(() => clearTimeout(paymentPoll))

async function pollForPaymentConfirmation(attempt = 0) {
  await load()
  if (overview.value?.entitlement.isPro) {
    toast.add({
      title: 'Pro is active',
      description: 'Bachs confirmed the payment and subscription period.',
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    return
  }
  if (attempt >= 5) {
    toast.add({
      title: 'Payment is still being verified',
      description: 'You can safely leave this page and return later. Pro activates only after Bachs confirms it.',
      color: 'neutral',
      icon: 'i-lucide-clock'
    })
    return
  }
  paymentPoll = setTimeout(() => pollForPaymentConfirmation(attempt + 1), 2000)
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
      <div>
        <h1 class="font-display text-2xl font-bold text-highlighted">
          Plans & billing
        </h1>
        <p class="mt-1 text-sm text-muted">
          One workspace plan covers everyone on your support team.
        </p>
      </div>

      <USkeleton
        v-if="loading"
        class="h-96 w-full rounded-2xl"
      />

      <template v-else-if="overview">
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
                class="rounded-lg px-3 py-2 text-xs font-medium transition-colors"
                :class="checkoutInterval === option.value ? 'bg-default text-highlighted shadow-sm' : 'text-muted hover:text-highlighted'"
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
              :disabled="!overview.configured"
              @click="startCheckout"
            >
              Upgrade to Pro
            </UButton>
            <p
              v-if="!overview.configured && !overview.entitlement.isPro"
              class="mt-2 text-center text-xs text-muted"
            >
              Checkout will be available when Bachs is configured.
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
