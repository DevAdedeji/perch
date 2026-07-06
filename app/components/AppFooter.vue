<script setup lang="ts">
const cols = [
  {
    title: 'Product',
    links: ['Control Room', 'Embed widget', 'Real-time engine', 'Integrations', 'Changelog']
  },
  {
    title: 'Developers',
    links: ['Documentation', 'WebSocket API', 'Widget SDK', 'Status', 'Open source']
  },
  {
    title: 'Company',
    links: ['About', 'Blog', 'Careers', 'Contact', 'Privacy']
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
              v-for="icon in ['i-simple-icons-github', 'i-simple-icons-x', 'i-simple-icons-discord']"
              :key="icon"
              :icon="icon"
              color="neutral"
              variant="soft"
              size="sm"
              square
              :aria-label="icon"
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
              :key="link"
            >
              <a
                href="#"
                class="text-sm text-muted hover:text-highlighted transition-colors"
              >{{ link }}</a>
            </li>
          </ul>
        </div>
      </div>

      <div class="mt-12 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-default pt-6">
        <p class="text-sm text-dimmed">
          © {{ year }} Perch. A portfolio build, made with care.
        </p>
        <p class="flex items-center gap-2 text-sm text-dimmed">
          <span class="size-2 rounded-full bg-green-500" />
          All systems operational
        </p>
      </div>
    </UContainer>
  </footer>
</template>
