<script setup lang="ts">
withDefaults(defineProps<{
  placeholder?: string
  autocomplete?: string
}>(), {
  placeholder: '••••••••',
  autocomplete: 'current-password'
})

const model = defineModel<string>()
const show = ref(false)
</script>

<template>
  <UInput
    v-model="model"
    :type="show ? 'text' : 'password'"
    :placeholder="placeholder"
    :autocomplete="autocomplete"
    size="lg"
    class="w-full"
  >
    <template #trailing>
      <UButton
        color="neutral"
        variant="link"
        size="sm"
        :icon="show ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        :aria-label="show ? 'Hide password' : 'Show password'"
        tabindex="-1"
        @click="show = !show"
      />
    </template>
  </UInput>
</template>
