<script setup lang="ts">
/**
 * The hero: the widget and the Control Room side by side, with a scripted
 * real-time loop playing between them — visitor types → message lands in the
 * inbox → Maya claims → typing → the reply flies back. Shows the product's
 * core promise instead of describing it.
 *
 * SSR renders the completed scene (good for crawlers / no-JS); the client
 * resets and loops. Respects prefers-reduced-motion by staying on the final frame.
 */

const VISITOR_MSG = 'Hey! Is the Pro plan monthly or annual?'
const AGENT_MSG = 'Hi 👋 Both — and annual saves you 20%.'

// initial state = final frame (what SSR ships)
const typedVisitor = ref('')
const typedAgent = ref('')
const showVisitorBubble = ref(true)
const rowVisible = ref(true)
const claimed = ref(true)
const claimFlash = ref(false)
const agentTyping = ref(false)
const showAgentBubble = ref(true)
const wireEvent = ref('message.new · 41ms')
const dir = ref<'ltr' | 'rtl' | null>(null)

let alive = true

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function typeInto(target: Ref<string>, text: string, perChar: number) {
  for (let i = 1; i <= text.length; i++) {
    if (!alive) return
    target.value = text.slice(0, i)
    await sleep(perChar)
  }
}

function pulse(label: string, direction: 'ltr' | 'rtl' | null) {
  wireEvent.value = label
  dir.value = direction
  setTimeout(() => (dir.value = null), 700)
}

function reset() {
  typedVisitor.value = ''
  typedAgent.value = ''
  showVisitorBubble.value = false
  rowVisible.value = false
  claimed.value = false
  claimFlash.value = false
  agentTyping.value = false
  showAgentBubble.value = false
}

async function run() {
  while (alive) {
    reset()
    wireEvent.value = 'visitor.hello · connected'
    await sleep(1100)

    // visitor types + sends
    await typeInto(typedVisitor, VISITOR_MSG, 26)
    if (!alive) return
    await sleep(300)
    typedVisitor.value = ''
    showVisitorBubble.value = true
    pulse('message.new · 38ms', 'ltr')
    await sleep(420)

    // lands in the inbox
    rowVisible.value = true
    wireEvent.value = 'conversation.new · unassigned'
    await sleep(1400)

    // Maya claims — atomically
    claimFlash.value = true
    await sleep(600)
    claimFlash.value = false
    claimed.value = true
    pulse('conversation.claim.ok · Maya', null)
    await sleep(1000)

    // Maya replies
    agentTyping.value = true
    await typeInto(typedAgent, AGENT_MSG, 22)
    if (!alive) return
    await sleep(300)
    typedAgent.value = ''
    agentTyping.value = false
    showAgentBubble.value = true
    pulse('message.new · 41ms', 'rtl')

    await sleep(3600)
  }
}

onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  run()
})
onBeforeUnmount(() => {
  alive = false
})
</script>

<template>
  <div class="relative">
    <div class="grid lg:grid-cols-[minmax(300px,360px)_5rem_1fr] gap-6 lg:gap-0 items-stretch">
      <!-- ── the visitor's widget ── -->
      <div class="relative rounded-2xl border-glow glass shadow-2xl shadow-black/20 overflow-hidden flex flex-col h-105 min-w-0">
        <div class="flex items-center gap-3 px-4 py-3 border-b border-default bg-elevated/50 shrink-0">
          <span class="grid place-items-center size-9 rounded-xl bg-amber-500/15 ring-1 ring-amber-500/30">
            <UIcon
              name="i-lucide-bird"
              class="size-4.5 text-amber-600 dark:text-amber-400"
            />
          </span>
          <div class="min-w-0">
            <p class="text-sm font-semibold text-highlighted leading-tight">
              {{ claimed ? 'Maya' : 'Perch Support' }}
            </p>
            <p class="flex items-center gap-1.5 text-xs text-muted">
              <span class="size-1.5 rounded-full bg-green-500" />
              {{ claimed ? 'from Perch' : 'Online · replies in seconds' }}
            </p>
          </div>
          <UIcon
            name="i-lucide-chevron-down"
            class="ml-auto size-4 text-dimmed"
          />
        </div>

        <div class="flex-1 flex flex-col justify-end gap-2.5 px-4 py-4 bg-grid overflow-hidden">
          <div class="flex items-end gap-2">
            <span class="theater-avatar">P</span>
            <div class="bubble-agent">
              Hi 👋 Ask us anything — we’re online.
            </div>
          </div>
          <div
            v-if="showVisitorBubble"
            class="flex flex-row-reverse msg-in"
          >
            <div class="bubble-visitor">
              {{ VISITOR_MSG }}
            </div>
          </div>
          <div
            v-if="agentTyping"
            class="flex items-end gap-2 msg-in"
          >
            <span class="theater-avatar">M</span>
            <div class="flex items-center gap-1 rounded-2xl rounded-bl-md bg-default ring-1 ring-default px-3.5 py-3">
              <span class="size-1.5 rounded-full bg-amber-500 animate-bounce [animation-delay:-0.3s]" />
              <span class="size-1.5 rounded-full bg-amber-500 animate-bounce [animation-delay:-0.15s]" />
              <span class="size-1.5 rounded-full bg-amber-500 animate-bounce" />
            </div>
          </div>
          <div
            v-if="showAgentBubble"
            class="flex items-end gap-2 msg-in"
          >
            <span class="theater-avatar">M</span>
            <div class="bubble-agent">
              {{ AGENT_MSG }}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 px-3 py-3 border-t border-default bg-elevated/50 shrink-0">
          <div class="flex-1 flex items-center rounded-xl bg-default ring-1 ring-default px-3 py-2 min-w-0">
            <span
              class="text-sm truncate"
              :class="typedVisitor ? 'text-highlighted' : 'text-dimmed'"
            >{{ typedVisitor || 'Type a message…' }}</span>
            <span
              v-if="typedVisitor"
              class="ml-0.5 inline-block w-0.5 h-3.5 bg-amber-500 animate-pulse shrink-0"
            />
          </div>
          <span class="grid place-items-center size-9 rounded-xl bg-amber-500 text-slate-950 shrink-0">
            <UIcon
              name="i-lucide-arrow-up"
              class="size-4"
            />
          </span>
        </div>
      </div>

      <!-- ── the wire between them ── -->
      <div class="hidden lg:flex flex-col items-center justify-center gap-3 px-3">
        <div class="relative w-full">
          <div class="h-px w-full border-t border-dashed border-accented" />
          <span
            v-if="dir"
            class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-2 rounded-full bg-amber-500 shadow-[0_0_12px_2px] shadow-amber-500/50"
            :class="dir === 'ltr' ? 'wire-ltr' : 'wire-rtl'"
          />
        </div>
        <UIcon
          name="i-lucide-zap"
          class="size-4 text-amber-500"
        />
      </div>

      <!-- ── the Control Room ── -->
      <div class="relative rounded-2xl border-glow glass shadow-2xl shadow-black/20 overflow-hidden flex flex-col h-105 min-w-0">
        <!-- chrome -->
        <div class="flex items-center gap-2 px-4 h-10 border-b border-default bg-elevated/60 shrink-0">
          <span class="size-2.5 rounded-full bg-red-400/80" />
          <span class="size-2.5 rounded-full bg-amber-400/80" />
          <span class="size-2.5 rounded-full bg-green-400/80" />
          <span class="ml-2 hidden sm:block font-mono text-[11px] text-dimmed">perch — control room</span>
          <div class="ml-auto flex items-center gap-2">
            <span class="flex items-center gap-1.5 text-[11px] text-green-600 dark:text-green-500">
              <span class="size-1.5 rounded-full bg-green-500 animate-pulse" /> live
            </span>
            <div class="flex -space-x-1.5">
              <span class="theater-presence">M</span>
              <span class="theater-presence">J</span>
            </div>
          </div>
        </div>

        <!-- inbox rows -->
        <div class="border-b border-default shrink-0">
          <div
            v-if="rowVisible"
            class="relative flex items-center gap-3 px-4 py-2.5 row-in"
            :class="claimed ? 'bg-amber-500/6' : ''"
          >
            <span
              v-if="claimed"
              class="absolute inset-y-0 left-0 w-0.5 bg-amber-500"
            />
            <span class="grid place-items-center size-8 shrink-0 rounded-lg bg-elevated ring-1 ring-default text-xs font-semibold text-muted">A</span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate text-[13px] font-semibold text-highlighted">Ava Thompson</span>
                <span class="ml-auto shrink-0 text-[11px] text-dimmed">now</span>
              </div>
              <p class="truncate text-xs text-muted mt-0.5">
                {{ VISITOR_MSG }}
              </p>
            </div>
            <span
              v-if="!claimed"
              class="flex items-center gap-1 rounded-lg bg-amber-500 px-2 py-1 text-[11px] font-semibold text-slate-950 transition-transform"
              :class="claimFlash ? 'scale-110 ring-2 ring-amber-500/50' : ''"
            >
              <UIcon
                name="i-lucide-hand"
                class="size-3"
              /> Claim
            </span>
            <span
              v-else
              class="grid place-items-center size-5 shrink-0 rounded-full bg-amber-500/15 text-[9px] font-bold text-amber-700 dark:text-amber-400"
            >M</span>
            <span
              v-if="!claimed"
              class="size-2 shrink-0 rounded-full bg-amber-500"
            />
          </div>

          <div class="flex items-center gap-3 px-4 py-2.5 border-t border-default/60 opacity-70">
            <span class="grid place-items-center size-8 shrink-0 rounded-lg bg-elevated ring-1 ring-default text-xs font-semibold text-muted">N</span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate text-[13px] font-medium text-highlighted">Noah Bennett</span>
                <span class="ml-auto shrink-0 text-[11px] text-dimmed">11m</span>
              </div>
              <p class="truncate text-xs text-muted mt-0.5">
                Thanks, that worked!
              </p>
            </div>
            <span class="grid place-items-center size-5 shrink-0 rounded-full bg-elevated ring-1 ring-default text-[9px] font-bold text-muted">J</span>
          </div>
        </div>

        <!-- thread -->
        <div class="flex-1 flex flex-col bg-grid min-h-0">
          <div
            v-if="!claimed"
            class="flex-1 grid place-items-center px-4"
          >
            <p class="text-xs text-dimmed">
              {{ rowVisible ? 'New conversation — claim it before Jide does.' : 'Waiting for conversations…' }}
            </p>
          </div>
          <div
            v-else
            class="flex-1 flex flex-col justify-end gap-2 px-4 py-3 overflow-hidden"
          >
            <div class="flex msg-in">
              <div class="bubble-agent max-w-[80%]!">
                {{ VISITOR_MSG }}
              </div>
            </div>
            <div
              v-if="showAgentBubble"
              class="flex flex-row-reverse msg-in"
            >
              <div class="bubble-visitor max-w-[80%]!">
                {{ AGENT_MSG }}
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2 px-3 py-2.5 border-t border-default bg-elevated/40 shrink-0">
            <div class="flex-1 flex items-center rounded-lg bg-default ring-1 ring-default px-3 py-2 min-w-0">
              <span
                class="text-xs truncate"
                :class="typedAgent ? 'text-highlighted' : 'text-dimmed'"
              >{{ typedAgent || 'Reply to Ava… ( / for canned replies )' }}</span>
              <span
                v-if="typedAgent"
                class="ml-0.5 inline-block w-0.5 h-3 bg-amber-500 animate-pulse shrink-0"
              />
            </div>
            <span class="grid place-items-center size-8 rounded-lg bg-amber-500 text-slate-950 shrink-0">
              <UIcon
                name="i-lucide-send-horizontal"
                class="size-3.5"
              />
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- current wire event -->
    <div class="mt-5 flex justify-center">
      <span class="flex items-center gap-2 rounded-full glass ring-1 ring-default px-3.5 py-1.5 font-mono text-xs text-muted">
        <span class="size-1.5 rounded-full bg-green-500 animate-pulse" />
        on the wire
        <span class="text-amber-600 dark:text-amber-400">▸ {{ wireEvent }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.theater-avatar {
  display: grid;
  place-items: center;
  width: calc(var(--spacing) * 6);
  height: calc(var(--spacing) * 6);
  flex-shrink: 0;
  border-radius: var(--radius-lg);
  background: color-mix(in oklab, var(--color-amber-500) 15%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-amber-500) 30%, transparent);
  font-size: 10px;
  font-weight: 600;
  color: var(--color-amber-600);
}

:root.dark .theater-avatar {
  color: var(--color-amber-400);
}

.theater-presence {
  position: relative;
  display: grid;
  place-items: center;
  width: calc(var(--spacing) * 6);
  height: calc(var(--spacing) * 6);
  border-radius: 9999px;
  background: var(--ui-bg-elevated);
  box-shadow: 0 0 0 2px var(--ui-bg-elevated), inset 0 -2px 0 0 var(--color-green-500);
  font-size: 10px;
  font-weight: 600;
  color: var(--ui-text-highlighted);
}

.bubble-visitor {
  max-width: 85%;
  border-radius: 1rem;
  border-bottom-right-radius: 0.375rem;
  background: var(--color-amber-500);
  color: var(--color-slate-950);
  padding: 0.5rem 0.875rem;
  font-size: 0.8125rem;
  line-height: 1.35;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}

.bubble-agent {
  max-width: 85%;
  border-radius: 1rem;
  border-bottom-left-radius: 0.375rem;
  background: var(--ui-bg);
  box-shadow: inset 0 0 0 1px var(--ui-border);
  color: var(--ui-text-highlighted);
  padding: 0.5rem 0.875rem;
  font-size: 0.8125rem;
  line-height: 1.35;
}

.msg-in {
  animation: theater-msg-in 0.2s ease both;
}

@keyframes theater-msg-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

.row-in {
  animation: theater-row-in 0.25s ease both;
}

@keyframes theater-row-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
}

.wire-ltr {
  animation: wire-ltr 0.6s ease-in-out both;
}

.wire-rtl {
  animation: wire-rtl 0.6s ease-in-out both;
}

@keyframes wire-ltr {
  from {
    left: 0%;
  }

  to {
    left: 100%;
  }
}

@keyframes wire-rtl {
  from {
    left: 100%;
  }

  to {
    left: 0%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .msg-in,
  .row-in,
  .wire-ltr,
  .wire-rtl {
    animation: none;
  }
}
</style>
