<script setup lang="ts">
import type { ResponseSlaDTO } from '@perch/shared'

const props = defineProps<{
  sla: ResponseSlaDTO
  now: Date
  showAnswered?: boolean
}>()

const status = computed(() => currentResponseSlaStatus(props.sla, props.now))
const visible = computed(() => props.showAnswered || status.value !== 'answered')
const color = computed(() => ({
  due: 'neutral' as const,
  approaching: 'warning' as const,
  breached: 'error' as const,
  paused: 'neutral' as const,
  answered: 'success' as const
})[status.value])
const icon = computed(() => ({
  due: 'i-lucide-timer',
  approaching: 'i-lucide-timer-reset',
  breached: 'i-lucide-circle-alert',
  paused: 'i-lucide-pause',
  answered: 'i-lucide-check'
})[status.value])
</script>

<template>
  <UBadge
    v-if="visible"
    :color="color"
    variant="subtle"
    size="sm"
    :icon="icon"
    :aria-label="`Response target: ${responseSlaLabel(sla, now)}`"
  >
    {{ responseSlaLabel(sla, now) }}
  </UBadge>
</template>
