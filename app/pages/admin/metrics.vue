<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Metrics · Perch' })

interface Metrics {
  totals: { users: string, workspaces: string, conversations: string, messages: string }
  last_7d: { new_users_7d: string, active_workspaces_7d: string, new_conversations_7d: string, messages_7d: string }
  daily: { day: string, signups: string, messages: string }[]
}

const metrics = ref<Metrics | null>(null)
const denied = ref(false)
const loading = ref(true)

onMounted(async () => {
  try {
    metrics.value = await $fetch<Metrics>('/api/admin/metrics')
  } catch {
    denied.value = true
  } finally {
    loading.value = false
  }
})

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
                class="w-full rounded-t bg-amber-500/70 group-hover:bg-amber-500 transition-colors"
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
              :class="Number(d.signups) > 0 ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-dimmed'"
            >{{ d.signups }}</span>
          </div>
          <p class="mt-1 text-center text-[10px] uppercase tracking-wider text-dimmed">
            signups / day
          </p>
        </section>
      </template>
    </div>
  </div>
</template>
