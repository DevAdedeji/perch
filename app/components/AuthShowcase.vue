<script setup lang="ts">
/**
 * Left half of the auth split-screen: Perch's core loop on a scripted timer —
 * a visitor asks, the chat lands in the shared inbox, an agent claims it, the
 * reply goes back. SSR ships the finished scene (crawlers / no-JS); the client
 * rewinds and loops it, and reduced motion simply keeps the final frame.
 */
const VISITOR_MSG = 'Hey! Is the Pro plan monthly or annual?'
const AGENT_MSG = 'Both — and annual saves you 20%.'

const proofs = [
  { icon: 'i-lucide-inbox', text: 'Every chat from your site lands in one shared inbox.' },
  { icon: 'i-lucide-hand', text: 'Claim a conversation and it’s yours — first click wins.' },
  { icon: 'i-lucide-sticky-note', text: 'Leave private notes your visitors never see.' }
]

// initial values are the final frame — the markup SSR ships
const visitorTyping = ref(false)
const visitorSent = ref(true)
const claimed = ref(true)
const agentTyping = ref(false)
const agentSent = ref(true)
const wire = ref('message.new · 41ms')
const proofIndex = ref(0)

const proof = computed(() => proofs[proofIndex.value] ?? proofs[0])

let alive = false

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function run() {
  while (alive) {
    visitorSent.value = false
    claimed.value = false
    agentTyping.value = false
    agentSent.value = false
    wire.value = 'visitor.hello · connected'
    await sleep(900)
    if (!alive) return

    visitorTyping.value = true
    await sleep(1500)
    if (!alive) return

    visitorTyping.value = false
    visitorSent.value = true
    wire.value = 'message.new · 38ms'
    await sleep(1300)
    if (!alive) return

    claimed.value = true
    wire.value = 'conversation.claimed · maya'
    await sleep(1400)
    if (!alive) return

    agentTyping.value = true
    await sleep(1300)
    if (!alive) return

    agentTyping.value = false
    agentSent.value = true
    wire.value = 'message.new · 41ms'
    await sleep(4200)
    if (!alive) return

    proofIndex.value = (proofIndex.value + 1) % proofs.length
  }
}

onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  alive = true
  void run()
})

onBeforeUnmount(() => {
  alive = false
})
</script>

<template>
  <aside class="relative isolate hidden overflow-hidden bg-slate-50 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:justify-between lg:border-r lg:border-default lg:px-10 lg:py-9 xl:px-14 dark:bg-slate-950">
    <div class="bg-grid pointer-events-none absolute inset-0 z-0 opacity-40" />

    <NuxtLink
      to="/"
      class="relative z-10 w-fit"
      aria-label="Perch home"
    >
      <PerchLogo />
    </NuxtLink>

    <div class="relative z-10 my-8">
      <h2 class="font-display text-3xl font-bold leading-tight tracking-tight text-highlighted xl:text-4xl">
        Live chat that feels
        <span class="text-primary-600 dark:text-primary-400">instant</span>.
      </h2>
      <p class="mt-3 max-w-md text-sm text-muted">
        Watch a conversation travel from a visitor’s screen to your team and back.
      </p>

      <!-- the scene: fixed height, messages stack up from the bottom like a real thread -->
      <div class="mt-7 w-full max-w-md overflow-hidden rounded-2xl bg-default/80 ring-1 ring-default dark:bg-elevated/60">
        <div class="flex items-center gap-2.5 border-b border-default px-4 py-3">
          <span class="avatar-primary grid size-8 place-items-center rounded-lg text-xs font-bold">AS</span>
          <div class="min-w-0">
            <p class="text-sm font-semibold leading-tight text-highlighted">
              Acme Support
            </p>
            <p class="text-[11px] text-muted">
              Control Room · shared inbox
            </p>
          </div>
          <span class="ml-auto flex items-center gap-1.5 rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-700 ring-1 ring-green-500/20 dark:text-green-400">
            <span class="size-1.5 rounded-full bg-green-500 dark:bg-green-400" />
            live
          </span>
        </div>

        <div class="flex h-58 flex-col justify-end gap-2.5 px-4 py-4">
          <Transition
            enter-active-class="transition duration-300 ease-out"
            enter-from-class="opacity-0 translate-y-2"
            leave-active-class="transition-none"
            leave-to-class="opacity-0"
          >
            <div
              v-if="visitorTyping"
              class="flex w-fit items-center gap-1 rounded-2xl rounded-bl-md bg-elevated px-3.5 py-3 ring-1 ring-default"
            >
              <span class="size-1.5 animate-bounce rounded-full bg-dimmed [animation-delay:-0.3s]" />
              <span class="size-1.5 animate-bounce rounded-full bg-dimmed [animation-delay:-0.15s]" />
              <span class="size-1.5 animate-bounce rounded-full bg-dimmed" />
            </div>
          </Transition>

          <Transition
            enter-active-class="transition duration-300 ease-out"
            enter-from-class="opacity-0 translate-y-2"
            leave-active-class="transition-none"
            leave-to-class="opacity-0"
          >
            <div
              v-if="visitorSent"
              class="max-w-[82%] rounded-2xl rounded-bl-md bg-elevated px-3.5 py-2 text-sm leading-snug text-highlighted ring-1 ring-default"
            >
              {{ VISITOR_MSG }}
            </div>
          </Transition>

          <Transition
            enter-active-class="transition duration-300 ease-out"
            enter-from-class="opacity-0 scale-95"
            leave-active-class="transition-none"
            leave-to-class="opacity-0"
          >
            <div
              v-if="claimed"
              class="flex w-fit items-center gap-1.5 self-center rounded-full bg-primary-500/10 px-2.5 py-1 text-[11px] font-medium text-primary-700 ring-1 ring-primary-500/25 dark:text-primary-300"
            >
              <UIcon
                name="i-lucide-hand"
                class="size-3"
              />
              Maya claimed this chat
            </div>
          </Transition>

          <Transition
            enter-active-class="transition duration-300 ease-out"
            enter-from-class="opacity-0 translate-y-2"
            leave-active-class="transition-none"
            leave-to-class="opacity-0"
          >
            <div
              v-if="agentTyping"
              class="flex w-fit items-center gap-1 self-end rounded-2xl rounded-br-md bg-elevated px-3.5 py-3 ring-1 ring-default"
            >
              <span class="size-1.5 animate-bounce rounded-full bg-dimmed [animation-delay:-0.3s]" />
              <span class="size-1.5 animate-bounce rounded-full bg-dimmed [animation-delay:-0.15s]" />
              <span class="size-1.5 animate-bounce rounded-full bg-dimmed" />
            </div>
          </Transition>

          <Transition
            enter-active-class="transition duration-300 ease-out"
            enter-from-class="opacity-0 translate-y-2"
            leave-active-class="transition-none"
            leave-to-class="opacity-0"
          >
            <div
              v-if="agentSent"
              class="max-w-[82%] self-end rounded-2xl rounded-br-md bg-primary-500 px-3.5 py-2 text-sm leading-snug font-medium text-slate-950"
            >
              {{ AGENT_MSG }}
            </div>
          </Transition>
        </div>

        <div class="flex items-center gap-2 border-t border-default bg-default/40 px-4 py-2.5 font-mono text-[11px] text-dimmed">
          <UIcon
            name="i-lucide-radio"
            class="size-3.5 shrink-0 text-primary-600 dark:text-primary-400"
          />
          <span class="truncate">{{ wire }}</span>
          <span class="ml-auto shrink-0">websocket</span>
        </div>
      </div>
    </div>

    <div class="relative z-10">
      <Transition
        mode="out-in"
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="opacity-0 translate-y-1"
        leave-active-class="transition duration-150 ease-in"
        leave-to-class="opacity-0"
      >
        <p
          :key="proofIndex"
          class="flex max-w-md items-start gap-2.5 text-sm text-muted"
        >
          <UIcon
            :name="proof?.icon ?? ''"
            class="mt-0.5 size-4 shrink-0 text-primary-600 dark:text-primary-400"
          />
          {{ proof?.text }}
        </p>
      </Transition>

      <div class="mt-4 flex items-center gap-1.5">
        <span
          v-for="(p, i) in proofs"
          :key="p.icon"
          class="h-1 rounded-full transition-all duration-500"
          :class="i === proofIndex ? 'w-6 bg-primary-500 dark:bg-primary-400' : 'w-1.5 bg-accented'"
        />
      </div>
    </div>
  </aside>
</template>
