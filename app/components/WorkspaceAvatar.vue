<script setup lang="ts">
const props = withDefaults(defineProps<{
  name?: string
  color?: string
  logoUrl?: string | null
  size?: number
}>(), {
  name: '',
  color: '#f59e0b',
  logoUrl: null,
  size: 56
})

const initials = computed(() =>
  (props.name || '').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'W'
)

// dark text on light backgrounds, white on dark — keeps initials legible
const textColor = computed(() => {
  const c = props.color.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#1c1917' : '#ffffff'
})
</script>

<template>
  <span
    class="grid place-items-center rounded-2xl font-display font-bold overflow-hidden shrink-0"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      background: color,
      color: textColor,
      fontSize: `${size * 0.36}px`,
      boxShadow: `0 8px 26px -10px ${color}`
    }"
  >
    <img
      v-if="logoUrl"
      :src="logoUrl"
      class="size-full object-cover"
      alt=""
    >
    <template v-else>{{ initials }}</template>
  </span>
</template>
