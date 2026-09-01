<script setup lang="ts">
import type { WidgetAppearance } from '~/utils/widget'

/**
 * The visitor-facing widget controls, shared by Settings and the install
 * checklist so the two can't drift. The draft lives in the parent — both
 * callers render their own preview from it — and saving stays the parent's job.
 */
const model = defineModel<WidgetAppearance>({ required: true })

withDefaults(defineProps<{
  /** agents may look, but only admins may change */
  disabled?: boolean
  saving?: boolean
  removeBrandingAllowed?: boolean
}>(), {
  disabled: false,
  saving: false,
  removeBrandingAllowed: true
})

const emit = defineEmits<{ save: [] }>()

const swatches = ['#8b5cf6', '#6366f1', '#f43f5e', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#0f172a']
const positionOptions = [
  { value: 'left', label: 'Left', icon: 'i-lucide-panel-left' },
  { value: 'right', label: 'Right', icon: 'i-lucide-panel-right' }
] as const
const sizeOptions = [
  { value: 'compact', label: 'Compact', icon: 'i-lucide-minimize-2' },
  { value: 'standard', label: 'Regular', icon: 'i-lucide-square' },
  { value: 'large', label: 'Large', icon: 'i-lucide-maximize-2' }
] as const
const themeOptions = [
  { value: 'light', label: 'Light', icon: 'i-lucide-sun' },
  { value: 'dark', label: 'Dark', icon: 'i-lucide-moon' },
  { value: 'system', label: 'System', icon: 'i-lucide-monitor' }
] as const

function set<K extends keyof WidgetAppearance>(key: K, value: WidgetAppearance[K]) {
  model.value = { ...model.value, [key]: value }
}

function field<K extends keyof WidgetAppearance>(key: K) {
  return computed({
    get: () => model.value[key],
    set: (value: WidgetAppearance[K]) => set(key, value)
  })
}

const greeting = field('widgetGreeting')
const intro = field('widgetIntro')
const offlineMessage = field('widgetOfflineMessage')
const primaryColor = field('widgetPrimaryColor')
const showBranding = field('widgetShowBranding')

const canSave = computed(() =>
  !!model.value.widgetGreeting.trim()
  && !!model.value.widgetIntro.trim()
  && !!model.value.widgetOfflineMessage.trim())
</script>

<template>
  <div class="space-y-5">
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField
        label="Greeting"
        help="The first line visitors see."
      >
        <UInput
          v-model="greeting"
          :disabled="disabled"
          :maxlength="80"
          class="w-full"
        />
      </UFormField>
      <UFormField
        label="Intro text"
        help="A short invitation to start chatting."
      >
        <UInput
          v-model="intro"
          :disabled="disabled"
          :maxlength="180"
          class="w-full"
        />
      </UFormField>
    </div>

    <UFormField
      label="Offline message"
      help="Shown when nobody is available."
    >
      <UTextarea
        v-model="offlineMessage"
        :disabled="disabled"
        :maxlength="220"
        :rows="2"
        autoresize
        class="w-full"
      />
    </UFormField>

    <div>
      <p class="text-sm font-medium text-highlighted">
        Brand color
      </p>
      <div class="mt-2 flex flex-wrap items-center gap-2.5">
        <button
          v-for="c in swatches"
          :key="`appearance-${c}`"
          type="button"
          :disabled="disabled"
          class="size-8 rounded-full ring-2 ring-offset-2 ring-offset-bg transition-transform hover:scale-110 disabled:opacity-60"
          :class="model.widgetPrimaryColor === c ? 'ring-highlighted' : 'ring-transparent'"
          :style="{ background: c }"
          :aria-label="`Use ${c}`"
          :aria-pressed="model.widgetPrimaryColor === c"
          @click="set('widgetPrimaryColor', c)"
        />
        <UInput
          v-model="primaryColor"
          :disabled="disabled"
          maxlength="7"
          class="w-28 font-mono"
          aria-label="Custom widget color"
        />
      </div>
    </div>

    <div class="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
      <div>
        <p class="text-sm font-medium text-highlighted">
          Position
        </p>
        <div class="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-elevated p-1 ring-1 ring-default">
          <button
            v-for="option in positionOptions"
            :key="option.value"
            type="button"
            :disabled="disabled"
            :aria-pressed="model.widgetPosition === option.value"
            class="flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors"
            :class="model.widgetPosition === option.value ? 'bg-default text-highlighted shadow-sm' : 'text-muted hover:text-highlighted'"
            @click="set('widgetPosition', option.value)"
          >
            <UIcon
              :name="option.icon"
              class="size-3.5 shrink-0"
            />
            <span>{{ option.label }}</span>
          </button>
        </div>
      </div>
      <div>
        <p class="text-sm font-medium text-highlighted">
          Size
        </p>
        <div class="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-elevated p-1 ring-1 ring-default">
          <button
            v-for="option in sizeOptions"
            :key="option.value"
            type="button"
            :disabled="disabled"
            :aria-pressed="model.widgetSize === option.value"
            class="flex min-w-0 items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium transition-colors"
            :class="model.widgetSize === option.value ? 'bg-default text-highlighted shadow-sm' : 'text-muted hover:text-highlighted'"
            @click="set('widgetSize', option.value)"
          >
            <UIcon
              :name="option.icon"
              class="size-3 shrink-0"
            />
            <span class="truncate">{{ option.label }}</span>
          </button>
        </div>
      </div>
      <div>
        <p class="text-sm font-medium text-highlighted">
          Theme
        </p>
        <div class="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-elevated p-1 ring-1 ring-default">
          <button
            v-for="option in themeOptions"
            :key="option.value"
            type="button"
            :disabled="disabled"
            :aria-pressed="model.widgetTheme === option.value"
            class="flex min-w-0 items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium transition-colors"
            :class="model.widgetTheme === option.value ? 'bg-default text-highlighted shadow-sm' : 'text-muted hover:text-highlighted'"
            @click="set('widgetTheme', option.value)"
          >
            <UIcon
              :name="option.icon"
              class="size-3 shrink-0"
            />
            <span class="truncate">{{ option.label }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="flex items-center justify-between gap-4 rounded-xl bg-default px-3.5 py-3 ring-1 ring-default">
      <div>
        <p class="text-sm font-medium text-highlighted">
          Show “Powered by Perch”
        </p>
        <p class="text-xs text-muted">
          Keep it visible or present the widget as fully yours on Pro.
        </p>
      </div>
      <USwitch
        v-model="showBranding"
        :disabled="disabled || (!removeBrandingAllowed && model.widgetShowBranding)"
        aria-label="Show Powered by Perch branding"
      />
    </div>

    <UButton
      v-if="!disabled"
      color="primary"
      icon="i-lucide-save"
      :loading="saving"
      :disabled="!canSave"
      @click="emit('save')"
    >
      Save appearance
    </UButton>
  </div>
</template>
