<script setup lang="ts">
const cols = [
  {
    title: 'Product',
    links: [
      { label: 'Get started', to: '/signup' },
      { label: 'Pricing', to: '/pricing' },
      { label: 'Sign in', to: '/login' }
    ]
  },
  {
    title: 'Support',
    links: [
      { label: 'Email support', to: 'mailto:adedejitewogbade2@gmail.com', external: true },
      { label: 'Service health', to: '/api/health', external: true }
    ]
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', to: '/privacy' },
      { label: 'Terms', to: '/terms' }
    ]
  }
]

const year = new Date().getFullYear()
</script>

<template>
  <footer class="relative mt-24 border-t border-default">
    <UContainer class="py-14">
      <div class="grid gap-10 lg:grid-cols-5">
        <div class="lg:col-span-2">
          <PerchLogo />
          <p class="mt-4 max-w-xs text-sm text-muted leading-relaxed">
            Real-time live chat for support teams. One script tag from “hello” to “how can I help?”.
          </p>
        </div>

        <div
          v-for="col in cols"
          :key="col.title"
        >
          <p class="text-sm font-semibold text-highlighted">
            {{ col.title }}
          </p>
          <ul class="mt-3 space-y-2.5">
            <li
              v-for="link in col.links"
              :key="link.label"
            >
              <a
                v-if="link.external"
                :href="link.to"
                :target="link.to.startsWith('mailto:') ? undefined : '_blank'"
                :rel="link.to.startsWith('mailto:') ? undefined : 'noreferrer'"
                class="text-sm text-muted hover:text-highlighted transition-colors"
              >{{ link.label }}</a>
              <NuxtLink
                v-else
                :to="link.to"
                class="text-sm text-muted hover:text-highlighted transition-colors"
              >{{ link.label }}</NuxtLink>
            </li>
          </ul>
        </div>
      </div>

      <div class="mt-12 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-default pt-6">
        <p class="text-sm text-dimmed">
          © {{ year }} Perch. Made with care.
        </p>
        <p class="flex items-center gap-2 text-sm text-dimmed">
          <span class="size-2 rounded-full bg-green-500" />
          Live service status
        </p>
      </div>
    </UContainer>
  </footer>
</template>
