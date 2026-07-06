<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Inbox · Perch' })

const toast = useToast()
const { primaryWorkspace } = useAuth()
const origin = useRequestURL().origin

// closing tag split so it doesn't terminate this SFC <script> block
const closeScript = '</' + 'script>'
const snippet = computed(() =>
  `<script src="${origin}/widget.js" data-site-id="${primaryWorkspace.value?.siteId ?? ''}" async>${closeScript}`
)

async function copySnippet() {
  try {
    await navigator.clipboard.writeText(snippet.value)
    toast.add({ title: 'Snippet copied', icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Copy failed', color: 'error' })
  }
}
</script>

<template>
  <div class="p-5 sm:p-8 max-w-3xl mx-auto">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h1 class="font-display text-2xl font-bold text-highlighted">
          Inbox
        </h1>
        <p class="mt-1 text-sm text-muted">
          Conversations from your widget land here in real time.
        </p>
      </div>
      <UBadge
        color="neutral"
        variant="subtle"
        size="lg"
        class="gap-1.5"
      >
        <span class="size-1.5 rounded-full bg-amber-400" /> 0 open
      </UBadge>
    </div>

    <!-- empty state -->
    <div class="mt-8 rounded-2xl border-glow bg-elevated/30 glass p-8 sm:p-10 text-center">
      <div class="mx-auto grid place-items-center size-14 rounded-2xl bg-amber-400/15 ring-1 ring-amber-400/25">
        <UIcon
          name="i-lucide-bird"
          class="size-7 text-amber-400"
        />
      </div>
      <h2 class="mt-5 font-display text-lg font-semibold text-highlighted">
        Your inbox is quiet
      </h2>
      <p class="mt-1.5 text-sm text-muted max-w-md mx-auto">
        Install your widget to start receiving chats. The moment a visitor says hi, it’ll appear here — live.
      </p>

      <div class="mt-6 text-left max-w-lg mx-auto rounded-xl bg-default ring-1 ring-default overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-2 border-b border-default bg-elevated/50">
          <UIcon
            name="i-lucide-code"
            class="size-4 text-dimmed"
          />
          <span class="text-xs font-mono text-dimmed">embed snippet</span>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-copy"
            class="ml-auto"
            @click="copySnippet"
          >
            Copy
          </UButton>
        </div>
        <pre class="p-4 text-xs sm:text-sm font-mono text-highlighted overflow-x-auto whitespace-pre-wrap break-all">{{ snippet }}</pre>
      </div>

      <p class="mt-6 text-xs text-dimmed">
        The live Control Room inbox is coming next.
      </p>
    </div>
  </div>
</template>
