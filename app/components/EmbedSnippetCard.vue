<script setup lang="ts">
const props = withDefaults(defineProps<{
  snippet: string
  compact?: boolean
}>(), {
  compact: false
})

const { copy } = useCopyToClipboard()

function copySnippet() {
  void copy(props.snippet, 'Snippet copied')
}
</script>

<template>
  <div class="rounded-xl bg-default ring-1 ring-default overflow-hidden">
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
    <pre
      class="p-4 font-mono text-highlighted overflow-x-auto whitespace-pre-wrap break-all"
      :class="compact ? 'text-xs' : 'text-xs sm:text-sm'"
    >{{ snippet }}</pre>
  </div>
</template>
