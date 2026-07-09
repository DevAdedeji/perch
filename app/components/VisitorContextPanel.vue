<script setup lang="ts">
import type { VisitorContext } from '~/composables/useControlRoom'

const props = defineProps<{
  context: VisitorContext | null
  fallbackName: string | null
}>()

const toast = useToast()

const displayName = computed(() => props.context?.visitor.name ?? props.fallbackName ?? 'Visitor')

function initials(name: string) {
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'V'
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const pageHost = computed(() => {
  const url = props.context?.visitor.page_url
  if (!url) return null
  try {
    const u = new URL(url)
    return u.host + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    return url
  }
})

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: 'Copied', icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Copy failed', color: 'error' })
  }
}
</script>

<template>
  <div class="flex flex-col h-full overflow-y-auto">
    <!-- identity -->
    <div class="p-5 border-b border-default text-center">
      <span class="mx-auto grid place-items-center size-14 rounded-2xl bg-amber-500/10 ring-1 ring-amber-500/25 text-lg font-bold text-amber-600 dark:text-amber-400">
        {{ initials(displayName) }}
      </span>
      <p class="mt-3 text-sm font-semibold text-highlighted truncate">
        {{ displayName }}
      </p>
      <button
        v-if="context?.visitor.email"
        class="mt-0.5 max-w-full truncate text-xs text-muted hover:text-highlighted transition-colors"
        :title="`Copy ${context.visitor.email}`"
        @click="copy(context.visitor.email!)"
      >
        {{ context.visitor.email }}
      </button>
      <p
        v-else
        class="mt-0.5 text-xs text-dimmed"
      >
        No email shared
      </p>
    </div>

    <div
      v-if="!context"
      class="p-5 space-y-3"
    >
      <USkeleton
        v-for="n in 4"
        :key="n"
        class="h-9 w-full"
      />
    </div>

    <template v-else>
      <!-- activity -->
      <div class="p-5 border-b border-default">
        <p class="text-[10px] font-semibold uppercase tracking-wider text-dimmed">
          Activity
        </p>
        <dl class="mt-3 space-y-2.5 text-xs">
          <div class="flex items-center justify-between gap-3">
            <dt class="text-muted shrink-0">
              First seen
            </dt>
            <dd class="text-highlighted text-right">
              {{ shortDate(context.visitor.first_seen_at) }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-3">
            <dt class="text-muted shrink-0">
              Last seen
            </dt>
            <dd class="text-highlighted text-right">
              {{ timeAgo(context.visitor.last_seen_at) }}
            </dd>
          </div>
          <div
            v-if="context.visitor.browser || context.visitor.os"
            class="flex items-center justify-between gap-3"
          >
            <dt class="text-muted shrink-0">
              Device
            </dt>
            <dd class="text-highlighted text-right">
              {{ [context.visitor.browser, context.visitor.os].filter(Boolean).join(' · ') }}
            </dd>
          </div>
          <div
            v-if="pageHost"
            class="flex items-start justify-between gap-3"
          >
            <dt class="text-muted shrink-0 pt-px">
              Viewing
            </dt>
            <dd class="min-w-0 text-right">
              <a
                :href="context.visitor.page_url!"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-1 max-w-full text-highlighted hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              >
                <span class="truncate">{{ pageHost }}</span>
                <UIcon
                  name="i-lucide-external-link"
                  class="size-3 shrink-0"
                />
              </a>
            </dd>
          </div>
        </dl>
      </div>

      <!-- history -->
      <div class="p-5 border-b border-default">
        <p class="text-[10px] font-semibold uppercase tracking-wider text-dimmed">
          History
        </p>
        <dl class="mt-3 space-y-2.5 text-xs">
          <div class="flex items-center justify-between gap-3">
            <dt class="text-muted">
              Conversation started
            </dt>
            <dd class="text-highlighted">
              {{ timeAgo(context.conversation.created_at) }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-3">
            <dt class="text-muted">
              Past conversations
            </dt>
            <dd class="font-semibold text-highlighted tabular-nums">
              {{ context.past_conversations }}
            </dd>
          </div>
          <div
            v-if="context.conversation.resolved_at"
            class="flex items-center justify-between gap-3"
          >
            <dt class="text-muted">
              Resolved
            </dt>
            <dd class="text-highlighted">
              {{ timeAgo(context.conversation.resolved_at) }}
            </dd>
          </div>
        </dl>
      </div>

      <!-- anonymous id -->
      <div class="p-5">
        <p class="text-[10px] font-semibold uppercase tracking-wider text-dimmed">
          Visitor ID
        </p>
        <button
          class="mt-2 w-full truncate rounded-lg bg-elevated/60 ring-1 ring-default px-2.5 py-1.5 text-left font-mono text-[11px] text-muted hover:text-highlighted transition-colors"
          title="Copy visitor id"
          @click="copy(context.visitor.visitor_id)"
        >
          {{ context.visitor.visitor_id }}
        </button>
      </div>
    </template>
  </div>
</template>
