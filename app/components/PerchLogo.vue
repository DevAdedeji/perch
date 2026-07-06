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
    <span class="grid place-items-center size-9 rounded-xl bg-elevated ring-1 ring-default">
      <UIcon
        name="i-lucide-bird"
        class="size-5 text-highlighted"
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
