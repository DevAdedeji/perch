<script setup lang="ts">
const cols = [
  {
    title: 'Product',
    links: [
      { label: 'Get started', to: '/signup' },
      { label: 'Sign in', to: '/login' },
      { label: 'Status', to: '/api/health', external: true }
    ]
  },
  {
    title: 'Developers',
    links: [
      { label: 'Source on GitHub', to: 'https://github.com/DevAdedeji/perch', external: true },
      { label: 'Report an issue', to: 'https://github.com/DevAdedeji/perch/issues', external: true }
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
          <div class="mt-5 flex items-center gap-2">
            <UButton
              icon="i-simple-icons-github"
              to="https://github.com/DevAdedeji/perch"
              target="_blank"
              color="neutral"
              variant="soft"
              size="sm"
              square
              aria-label="Perch on GitHub"
            />
          </div>
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
              <NuxtLink
                :to="link.to"
                :target="link.external ? '_blank' : undefined"
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
          All systems operational
        </p>
      </div>
    </UContainer>
  </footer>
</template>
