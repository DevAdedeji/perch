<script setup lang="ts">
interface Line { from: 'visitor' | 'agent' | 'typing', text?: string }

const script: Line[] = [
  { from: 'visitor', text: 'Hey! Is the Pro plan monthly or annual?' },
  { from: 'typing' },
  { from: 'agent', text: 'Hi 👋 Both — and annual saves you 20%.' },
  { from: 'visitor', text: 'Nice. Can I switch plans later?' },
  { from: 'typing' },
  { from: 'agent', text: 'Anytime, right from settings. Want me to set it up?' }
]

const messages = ref<Array<{ id: number, from: string, text: string }>>([])
const typing = ref(false)
const latency = ref(41)

let uid = 0
let alive = false
const timers: ReturnType<typeof setTimeout>[] = []

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    timers.push(setTimeout(resolve, ms))
  })
}

async function play() {
  while (alive) {
    messages.value = []
    await wait(700)
    for (const step of script) {
      if (!alive) return
      if (step.from === 'typing') {
        typing.value = true
        await wait(1350)
        typing.value = false
      } else {
        messages.value.push({ id: uid++, from: step.from, text: step.text! })
        await wait(step.from === 'agent' ? 1650 : 1150)
      }
    }
    await wait(2800)
  }
}

let latencyTimer: ReturnType<typeof setInterval>

onMounted(() => {
  alive = true
  play()
  latencyTimer = setInterval(() => {
    latency.value = 36 + Math.round(Math.random() * 16)
  }, 1400)
})

onBeforeUnmount(() => {
  alive = false
  timers.forEach(clearTimeout)
  clearInterval(latencyTimer)
})
</script>

<template>
  <div class="relative w-full max-w-sm mx-auto">
    <!-- floating status pill -->
    <div
      class="absolute -top-4 -left-4 z-20 hidden sm:flex items-center gap-2 rounded-full glass ring-1 ring-default px-3 py-1.5 shadow-xl shadow-black/10 animate-float"
    >
      <span class="relative flex size-2">
        <span class="absolute inline-flex size-full rounded-full bg-amber-400 opacity-75 animate-ping" />
        <span class="relative inline-flex size-2 rounded-full bg-amber-400" />
      </span>
      <span class="text-xs font-medium text-highlighted">Maya claimed this chat</span>
    </div>

    <!-- latency badge -->
    <div
      class="absolute -bottom-4 -right-3 z-20 hidden sm:flex items-center gap-1.5 rounded-full glass ring-1 ring-default px-3 py-1.5 shadow-xl shadow-black/10 animate-float-slow"
    >
      <UIcon
        name="i-lucide-zap"
        class="size-3.5 text-amber-400"
      />
      <span class="font-mono text-xs text-muted">{{ latency }}ms delivery</span>
    </div>

    <!-- widget panel -->
    <div class="relative rounded-3xl border-glow bg-elevated/40 glass shadow-2xl shadow-black/20 overflow-hidden">
      <!-- header -->
      <div class="flex items-center gap-3 px-4 py-3.5 border-b border-default bg-elevated/50">
        <span class="relative grid place-items-center size-9 rounded-xl bg-amber-400/15 ring-1 ring-amber-400/30">
          <UIcon
            name="i-lucide-bird"
            class="size-4.5 text-amber-400"
          />
        </span>
        <div class="min-w-0">
          <p class="text-sm font-semibold text-highlighted leading-tight">
            Perch Support
          </p>
          <p class="flex items-center gap-1.5 text-xs text-muted">
            <span class="size-1.5 rounded-full bg-amber-400" />
            Online · replies in seconds
          </p>
        </div>
        <UIcon
          name="i-lucide-chevron-down"
          class="ml-auto size-4 text-dimmed"
        />
      </div>

      <!-- thread -->
      <div class="h-[320px] px-4 py-4 flex flex-col justify-end gap-2.5 bg-grid">
        <TransitionGroup
          enter-active-class="transition duration-400 ease-out"
          enter-from-class="opacity-0 translate-y-3 scale-95"
          move-class="transition duration-300"
        >
          <div
            v-for="m in messages"
            :key="m.id"
            class="flex items-end gap-2"
            :class="m.from === 'visitor' ? 'flex-row-reverse' : ''"
          >
            <span
              v-if="m.from === 'agent'"
              class="grid place-items-center size-6 shrink-0 rounded-lg bg-amber-400/15 ring-1 ring-amber-400/25 text-[10px] font-semibold text-amber-400"
            >M</span>
            <div
              class="max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-snug shadow-sm"
              :class="m.from === 'visitor'
                ? 'bg-amber-500 text-white rounded-br-md'
                : 'bg-default ring-1 ring-default text-highlighted rounded-bl-md'"
            >
              {{ m.text }}
            </div>
          </div>
        </TransitionGroup>

        <!-- typing indicator -->
        <Transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0 translate-y-2"
          leave-active-class="transition duration-150 ease-in"
          leave-to-class="opacity-0"
        >
          <div
            v-if="typing"
            class="flex items-end gap-2"
          >
            <span class="grid place-items-center size-6 shrink-0 rounded-lg bg-amber-400/15 ring-1 ring-amber-400/25 text-[10px] font-semibold text-amber-400">M</span>
            <div class="flex items-center gap-1 rounded-2xl rounded-bl-md bg-default ring-1 ring-default px-3.5 py-3">
              <span class="size-1.5 rounded-full bg-dimmed animate-bounce [animation-delay:-0.3s]" />
              <span class="size-1.5 rounded-full bg-dimmed animate-bounce [animation-delay:-0.15s]" />
              <span class="size-1.5 rounded-full bg-dimmed animate-bounce" />
            </div>
          </div>
        </Transition>
      </div>

      <!-- input -->
      <div class="flex items-center gap-2 px-3 py-3 border-t border-default bg-elevated/50">
        <div class="flex-1 flex items-center gap-2 rounded-xl bg-default ring-1 ring-default px-3 py-2">
          <span class="text-sm text-dimmed">Type a message…</span>
          <span class="w-px h-4 bg-amber-400 animate-blink ml-0.5" />
        </div>
        <span class="grid place-items-center size-9 rounded-xl bg-amber-500 text-white">
          <UIcon
            name="i-lucide-arrow-up"
            class="size-4"
          />
        </span>
      </div>
    </div>
  </div>
</template>
