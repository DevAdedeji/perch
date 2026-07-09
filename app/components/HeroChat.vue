<script setup lang="ts">
// static snapshot of a conversation — no motion
const messages = [
  { from: 'visitor', text: 'Hey! Is the Pro plan monthly or annual?' },
  { from: 'agent', text: 'Hi 👋 Both — and annual saves you 20%.' },
  { from: 'visitor', text: 'Nice. Can I switch plans later?' },
  { from: 'agent', text: 'Anytime, right from settings. Want me to set it up?' },
  { from: 'visitor', text: 'Yes please 🙌' }
]
</script>

<template>
  <div class="relative w-full max-w-md xl:max-w-lg mx-auto">
    <!-- floating status pill -->
    <div class="absolute -top-4 -left-4 z-20 hidden sm:flex items-center gap-2 rounded-full glass ring-1 ring-default px-3 py-1.5 shadow-xl shadow-black/10">
      <span class="size-2 rounded-full bg-green-500" />
      <span class="text-xs font-medium text-highlighted">Maya claimed this chat</span>
    </div>

    <!-- latency badge -->
    <div class="absolute -bottom-4 -right-3 z-20 hidden sm:flex items-center gap-1.5 rounded-full glass ring-1 ring-default px-3 py-1.5 shadow-xl shadow-black/10">
      <UIcon
        name="i-lucide-zap"
        class="size-3.5 text-amber-500"
      />
      <span class="font-mono text-xs text-muted">41ms delivery</span>
    </div>

    <!-- widget panel -->
    <div class="relative rounded-3xl border-glow bg-elevated/40 glass shadow-2xl shadow-black/20 overflow-hidden">
      <!-- header -->
      <div class="flex items-center gap-3 px-4 py-3.5 border-b border-default bg-elevated/50">
        <span class="relative grid place-items-center size-9 rounded-xl bg-amber-500/15 ring-1 ring-amber-500/30">
          <UIcon
            name="i-lucide-bird"
            class="size-4.5 text-amber-600 dark:text-amber-400"
          />
        </span>
        <div class="min-w-0">
          <p class="text-sm font-semibold text-highlighted leading-tight">
            Perch Support
          </p>
          <p class="flex items-center gap-1.5 text-xs text-muted">
            <span class="size-1.5 rounded-full bg-green-500" />
            Online · replies in seconds
          </p>
        </div>
        <UIcon
          name="i-lucide-chevron-down"
          class="ml-auto size-4 text-dimmed"
        />
      </div>

      <!-- thread (content-sized — no dead space above the first message) -->
      <div class="px-5 py-6 flex flex-col gap-2.5 bg-grid">
        <div
          v-for="(m, i) in messages"
          :key="i"
          class="flex items-end gap-2"
          :class="m.from === 'visitor' ? 'flex-row-reverse' : ''"
        >
          <span
            v-if="m.from === 'agent'"
            class="grid place-items-center size-6 shrink-0 rounded-lg bg-amber-500/15 ring-1 ring-amber-500/30 text-[10px] font-semibold text-amber-700 dark:text-amber-400"
          >M</span>
          <div
            class="max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-snug shadow-sm"
            :class="m.from === 'visitor'
              ? 'bg-amber-500 text-slate-950 rounded-br-md'
              : 'bg-default ring-1 ring-default text-highlighted rounded-bl-md'"
          >
            {{ m.text }}
          </div>
        </div>
        <div class="flex items-end gap-2">
          <span class="grid place-items-center size-6 shrink-0 rounded-lg bg-amber-500/15 ring-1 ring-amber-500/30 text-[10px] font-semibold text-amber-700 dark:text-amber-400">M</span>
          <div class="flex items-center gap-1 rounded-2xl rounded-bl-md bg-default ring-1 ring-default px-3.5 py-3">
            <span class="size-1.5 rounded-full bg-amber-500 animate-bounce [animation-delay:-0.3s]" />
            <span class="size-1.5 rounded-full bg-amber-500 animate-bounce [animation-delay:-0.15s]" />
            <span class="size-1.5 rounded-full bg-amber-500 animate-bounce" />
          </div>
        </div>
      </div>

      <!-- input -->
      <div class="flex items-center gap-2 px-3 py-3 border-t border-default bg-elevated/50">
        <div class="flex-1 flex items-center gap-2 rounded-xl bg-default ring-1 ring-default px-3 py-2">
          <span class="text-sm text-dimmed">Type a message…</span>
        </div>
        <span class="grid place-items-center size-9 rounded-xl bg-amber-500 text-slate-950">
          <UIcon
            name="i-lucide-arrow-up"
            class="size-4"
          />
        </span>
      </div>
    </div>
  </div>
</template>
