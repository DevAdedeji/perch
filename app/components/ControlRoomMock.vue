<script setup lang="ts">
const filters = [
  { label: 'Unassigned', count: 3, active: false },
  { label: 'Open', count: 8, active: true },
  { label: 'Resolved', count: 24, active: false }
]

const convos = [
  { name: 'Ava Thompson', msg: 'Does the export include CSV?', time: '2m', owner: 'M', unread: true, active: true },
  { name: 'Noah Bennett', msg: 'Typing…', time: '4m', owner: 'J', unread: false, active: false, typing: true },
  { name: 'Visitor · Berlin', msg: 'Thanks, that worked!', time: '11m', owner: 'M', unread: false, active: false },
  { name: 'Liam Carter', msg: 'Can you reassign this to sales?', time: '18m', owner: '', unread: true, active: false }
]

// a full support team — presence UI below must not grow with its size
const team = [
  { initial: 'M', status: 'online' },
  { initial: 'J', status: 'online' },
  { initial: 'A', status: 'online' },
  { initial: 'S', status: 'online' },
  { initial: 'D', status: 'online' },
  { initial: 'K', status: 'online' },
  { initial: 'P', status: 'online' },
  { initial: 'L', status: 'online' },
  { initial: 'R', status: 'away' },
  { initial: 'T', status: 'away' },
  { initial: 'N', status: 'away' },
  { initial: 'E', status: 'offline' },
  { initial: 'C', status: 'offline' },
  { initial: 'B', status: 'offline' }
]

const onlineCount = computed(() => team.filter(a => a.status === 'online').length)
const stack = computed(() => team.slice(0, 3)) // avatars shown before "+N"
const extra = computed(() => Math.max(team.length - stack.value.length, 0))

// monochrome, brand-cohesive presence — no green
function dot(status: string) {
  if (status === 'online') return 'bg-amber-400'
  if (status === 'away') return 'bg-zinc-400'
  return 'bg-zinc-600'
}
</script>

<template>
  <div class="relative rounded-2xl border-glow bg-elevated/40 glass shadow-2xl shadow-black/30 overflow-hidden">
    <!-- window chrome -->
    <div class="flex items-center gap-2 px-4 h-11 border-b border-default bg-elevated/60">
      <span class="size-3 rounded-full bg-red-400/70" />
      <span class="size-3 rounded-full bg-amber-400/70" />
      <span class="size-3 rounded-full bg-zinc-400/50" />
      <div class="ml-3 hidden sm:flex items-center gap-1.5 text-xs text-dimmed font-mono">
        <UIcon
          name="i-lucide-lock"
          class="size-3"
        />
        app.perch.chat/control-room
      </div>
      <div class="ml-auto flex items-center gap-2.5">
        <span class="hidden sm:flex items-center gap-1.5 text-[11px] text-muted">
          <span class="size-1.5 rounded-full bg-amber-400" />
          {{ onlineCount }} online
        </span>
        <div class="flex -space-x-2">
          <span
            v-for="a in stack"
            :key="a.initial"
            class="relative grid place-items-center size-7 rounded-full bg-elevated ring-2 ring-elevated text-[11px] font-semibold text-highlighted"
          >
            {{ a.initial }}
            <span
              class="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-elevated"
              :class="dot(a.status)"
            />
          </span>
          <span
            v-if="extra > 0"
            class="grid place-items-center size-7 rounded-full bg-elevated ring-2 ring-elevated text-[10px] font-semibold text-muted"
          >+{{ extra }}</span>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-[180px_1fr] lg:grid-cols-[180px_300px_1fr] h-115">
      <!-- rail -->
      <aside class="hidden md:flex flex-col gap-1 p-3 border-r border-default bg-elevated/30">
        <div class="flex items-center gap-2 px-1.5 py-1">
          <PerchLogo />
        </div>
        <div class="mt-3 space-y-0.5">
          <p class="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-dimmed">
            Inbox
          </p>
          <div
            v-for="f in filters"
            :key="f.label"
            class="flex items-center justify-between rounded-lg px-2.5 py-2 text-[13px] transition-colors"
            :class="f.active ? 'bg-amber-400/10 text-amber-400 ring-1 ring-amber-400/20 font-medium' : 'text-muted'"
          >
            <span>{{ f.label }}</span>
            <span class="font-mono text-xs">{{ f.count }}</span>
          </div>
        </div>
        <div class="mt-auto pt-3 border-t border-default space-y-2.5">
          <!-- team summary — fixed height for any team size -->
          <div class="flex items-center justify-between px-2">
            <span class="text-[10px] font-medium uppercase tracking-wider text-dimmed">Team</span>
            <span class="text-[10px] text-dimmed">{{ team.length }} agents</span>
          </div>
          <div class="flex items-center gap-2 px-2">
            <div class="flex -space-x-1.5">
              <span
                v-for="a in stack"
                :key="a.initial"
                class="relative grid place-items-center size-6 rounded-full bg-elevated ring-2 ring-elevated text-[10px] font-semibold text-muted"
              >
                {{ a.initial }}
                <span
                  class="absolute -bottom-px -right-px size-2 rounded-full ring-2 ring-elevated"
                  :class="dot(a.status)"
                />
              </span>
              <span
                v-if="extra > 0"
                class="grid place-items-center size-6 rounded-full bg-elevated ring-2 ring-elevated text-[9px] font-semibold text-dimmed"
              >+{{ extra }}</span>
            </div>
            <span class="text-[11px] text-muted">
              <span class="font-medium text-amber-400">{{ onlineCount }}</span> online
            </span>
          </div>

          <!-- your own presence -->
          <div class="flex items-center gap-2 rounded-lg bg-elevated/60 ring-1 ring-default px-2.5 py-2">
            <span class="relative grid place-items-center size-6 rounded-full bg-amber-400/15 text-[10px] font-semibold text-amber-400">
              Y
              <span class="absolute -bottom-px -right-px size-2 rounded-full bg-amber-400 ring-2 ring-elevated" />
            </span>
            <span class="text-[12px] font-medium text-highlighted">You</span>
            <span class="ml-auto flex items-center gap-1 text-[10px] text-muted">
              Online
              <UIcon
                name="i-lucide-chevron-down"
                class="size-3"
              />
            </span>
          </div>
        </div>
      </aside>

      <!-- inbox list -->
      <section class="border-r border-default bg-elevated/10 overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-default">
          <span class="text-sm font-semibold text-highlighted">Open</span>
          <span class="flex items-center gap-1.5 text-[11px] text-amber-400">
            <span class="size-2 rounded-full bg-amber-400" />
            live
          </span>
        </div>
        <div class="divide-y divide-default/50">
          <div
            v-for="c in convos"
            :key="c.name"
            class="relative flex items-center gap-3 px-4 py-3.5"
            :class="c.active ? 'bg-amber-400/6' : ''"
          >
            <span
              v-if="c.active"
              class="absolute inset-y-0 left-0 w-0.5 bg-amber-400"
            />
            <span class="grid place-items-center size-8 shrink-0 rounded-lg bg-elevated ring-1 ring-default text-xs font-semibold text-muted">
              {{ c.name.charAt(0) }}
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate text-[13px] font-medium text-highlighted">{{ c.name }}</span>
                <span class="ml-auto shrink-0 text-[11px] text-dimmed">{{ c.time }}</span>
              </div>
              <p
                class="truncate text-xs mt-0.5"
                :class="c.typing ? 'text-amber-400 italic' : 'text-muted'"
              >
                {{ c.msg }}
              </p>
            </div>
            <span
              v-if="c.unread"
              class="size-2 shrink-0 rounded-full bg-amber-400"
            />
            <span
              v-else-if="c.owner"
              class="grid place-items-center size-5 shrink-0 rounded-full bg-amber-400/15 text-[9px] font-bold text-amber-400"
            >{{ c.owner }}</span>
          </div>
        </div>
      </section>

      <!-- conversation pane -->
      <section class="hidden lg:flex flex-col bg-grid relative overflow-hidden">
        <div class="flex items-center gap-3 px-5 py-3 border-b border-default bg-elevated/40">
          <span class="grid place-items-center size-9 rounded-lg bg-elevated ring-1 ring-default text-sm font-semibold text-muted">A</span>
          <div class="min-w-0">
            <p class="text-sm font-medium text-highlighted leading-tight">
              Ava Thompson
            </p>
            <p class="text-[11px] text-dimmed truncate">
              Berlin · Chrome · first seen 3d ago
            </p>
          </div>
          <div class="ml-auto flex items-center gap-2">
            <span class="rounded-md bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-400 ring-1 ring-amber-400/20 whitespace-nowrap">Owned by Maya</span>
            <span class="grid place-items-center size-7 rounded-md ring-1 ring-default text-dimmed">
              <UIcon
                name="i-lucide-check"
                class="size-4"
              />
            </span>
          </div>
        </div>

        <div class="flex-1 flex flex-col justify-end gap-2.5 px-5 py-5">
          <div class="flex gap-2">
            <div class="max-w-[65%] rounded-2xl rounded-bl-md bg-default ring-1 ring-default px-3.5 py-2 text-[13px] text-highlighted">
              Does the export include CSV?
            </div>
          </div>
          <div class="flex flex-row-reverse gap-2">
            <div class="max-w-[65%] rounded-2xl rounded-br-md bg-amber-500 px-3.5 py-2 text-[13px] text-white">
              Yes — CSV and JSON, on every plan.
            </div>
          </div>
          <div class="flex justify-center py-1">
            <span class="rounded-full bg-zinc-500/10 px-3 py-1 text-[11px] text-muted ring-1 ring-default">
              <UIcon
                name="i-lucide-lock"
                class="inline size-3 -mt-0.5"
              /> Internal note · agent-only
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2 px-4 py-3 border-t border-default bg-elevated/40">
          <div class="flex-1 rounded-lg bg-default ring-1 ring-default px-3.5 py-2.5 text-xs text-dimmed">
            Type <span class="font-mono text-amber-400">/hello</span> to insert a canned reply…
          </div>
          <span class="grid place-items-center size-9 rounded-lg bg-amber-500 text-white">
            <UIcon
              name="i-lucide-arrow-up"
              class="size-4"
            />
          </span>
        </div>
      </section>
    </div>
  </div>
</template>
