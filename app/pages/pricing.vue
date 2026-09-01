<script setup lang="ts">
useSeoMeta({
  title: 'Pricing · Perch',
  description: 'Simple Perch pricing for fast customer support: a generous Free workspace and one flat Pro plan without per-seat fees.'
})

const plans = [
  {
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    description: 'For a small team proving its support workflow.',
    features: [
      'Unlimited customer conversations',
      '2 teammates',
      'Shared inbox and Nest team chat',
      'Help center, canned replies and core automations',
      '15-minute unanswered-message reminders',
      'Perch branding in the widget'
    ],
    cta: 'Create a workspace',
    primary: false
  },
  {
    name: 'Pro',
    price: '$9',
    cadence: 'per workspace / month',
    yearly: '$90 yearly — save $18',
    description: 'For teams that want Perch to grow with their support operation.',
    features: [
      'Everything in Free',
      'Unlimited teammates — no per-seat fees',
      'Custom unanswered-message reminder timing',
      'Business-hours-only reminder delivery',
      'Remove “Powered by Perch” branding',
      'One subscription covers the whole workspace'
    ],
    cta: 'Get started',
    primary: true
  }
]
</script>

<template>
  <main class="relative overflow-hidden pt-32 sm:pt-40">
    <div class="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem] bg-grid mask-[radial-gradient(ellipse_70%_60%_at_50%_0%,#000,transparent)]" />
    <UContainer>
      <div class="mx-auto max-w-3xl text-center">
        <p class="text-sm font-semibold uppercase tracking-[0.2em] text-primary-600 dark:text-primary-400">
          Pricing
        </p>
        <h1 class="mt-4 font-display text-4xl font-bold tracking-tight text-highlighted sm:text-6xl">
          Straightforward support software pricing.
        </h1>
        <p class="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted">
          Start small, keep every conversation, and upgrade the workspace—not each teammate—when your team needs more control.
        </p>
      </div>

      <div class="mx-auto mt-12 grid max-w-5xl gap-6 lg:grid-cols-2">
        <section
          v-for="plan in plans"
          :key="plan.name"
          class="relative rounded-3xl p-7 glass sm:p-9"
          :class="plan.primary ? 'border border-primary-500/50 bg-primary-500/5 shadow-xl shadow-primary-500/5' : 'border-glow bg-elevated/30'"
        >
          <UBadge
            v-if="plan.primary"
            color="primary"
            class="absolute right-7 top-7"
          >
            Launch plan
          </UBadge>
          <p class="font-display text-xl font-semibold text-highlighted">
            {{ plan.name }}
          </p>
          <p class="mt-5 font-display text-5xl font-bold text-highlighted">
            {{ plan.price }}
          </p>
          <p class="mt-1 text-sm text-muted">
            {{ plan.cadence }}
          </p>
          <p
            v-if="plan.yearly"
            class="mt-1 text-xs font-medium text-primary-600 dark:text-primary-400"
          >
            {{ plan.yearly }}
          </p>
          <p class="mt-5 text-sm leading-relaxed text-muted">
            {{ plan.description }}
          </p>
          <ul class="mt-7 space-y-3.5">
            <li
              v-for="feature in plan.features"
              :key="feature"
              class="flex items-start gap-3 text-sm text-muted"
            >
              <span class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary-500/10 text-primary-600 dark:text-primary-400">
                <UIcon
                  name="i-lucide-check"
                  class="size-3.5"
                />
              </span>
              {{ feature }}
            </li>
          </ul>
          <UButton
            to="/signup"
            block
            size="lg"
            class="mt-8"
            :color="plan.primary ? 'primary' : 'neutral'"
            :variant="plan.primary ? 'solid' : 'subtle'"
            trailing-icon="i-lucide-arrow-right"
          >
            {{ plan.cta }}
          </UButton>
        </section>
      </div>

      <section class="mx-auto mt-12 max-w-3xl rounded-2xl bg-elevated/30 p-6 text-center ring-1 ring-default sm:p-8">
        <h2 class="font-display text-xl font-semibold text-highlighted">
          What counts as a workspace?
        </h2>
        <p class="mt-2 text-sm leading-relaxed text-muted">
          A workspace is one shared customer-support operation: its inbox, widget, teammates, help center and settings. Everyone invited to it shares the same plan.
        </p>
      </section>
    </UContainer>
  </main>
</template>
