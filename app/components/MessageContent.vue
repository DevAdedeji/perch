<script setup lang="ts">
import { messageTextSegments } from '~/utils/message-links'

const props = defineProps<{ content: string }>()
const segments = computed(() => messageTextSegments(props.content))
</script>

<template>
  <template
    v-for="(segment, index) in segments"
    :key="index"
  >
    <a
      v-if="segment.href"
      :href="segment.href"
      target="_blank"
      rel="noopener noreferrer"
      class="font-medium underline decoration-current/50 underline-offset-2 hover:decoration-current break-all"
    >{{ segment.text }}</a>
    <template v-else>
      {{ segment.text }}
    </template>
  </template>
</template>
