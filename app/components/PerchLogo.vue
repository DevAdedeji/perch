<script setup lang="ts">
withDefaults(defineProps<{
  /** show the "Perch" wordmark next to the mark */
  showText?: boolean
}>(), {
  showText: true
})
</script>

<template>
  <span class="inline-flex items-center gap-2.5 select-none">
    <span class="relative grid place-items-center size-9 rounded-xl bg-elevated/60 ring-1 ring-default overflow-hidden">
      <!-- soft glow behind the mark -->
      <span class="absolute inset-0 bg-amber-400/20 blur-md" />
      <UIcon
        name="i-lucide-bird"
        class="relative size-5 text-amber-400"
      />
    </span>
    <span
      v-if="showText"
      class="font-display text-lg font-semibold tracking-tight text-highlighted"
    >
      Perch
    </span>
  </span>
</template>
