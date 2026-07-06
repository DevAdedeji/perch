<script setup lang="ts">
const emit = defineEmits<{ navigate: [] }>()

const { user, workspaces, currentWorkspace, setWorkspace, logout } = useAuth()

const nav = [
  { label: 'Inbox', icon: 'i-lucide-inbox', to: '/dashboard', soon: false },
  { label: 'Team', icon: 'i-lucide-users', to: '/dashboard', soon: true },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/dashboard', soon: true }
]

const canSwitch = computed(() => workspaces.value.length > 1)
const switcherOpen = ref(false)

const initials = computed(() =>
  (user.value?.name ?? '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
)

function pickWorkspace(id: string) {
  setWorkspace(id)
  switcherOpen.value = false
}
</script>

<template>
  <div class="flex h-full w-full min-w-0 flex-col bg-default">
    <div class="h-16 flex items-center px-5 border-b border-default">
      <PerchLogo />
    </div>

    <!-- workspace switcher -->
    <div class="px-3 py-3 border-b border-default">
      <UPopover
        v-if="canSwitch"
        v-model:open="switcherOpen"
        :content="{ align: 'start', side: 'bottom' }"
      >
        <button class="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 bg-elevated/50 ring-1 ring-default text-left hover:bg-elevated transition-colors">
          <span class="grid place-items-center size-8 shrink-0 rounded-lg bg-inverted/15 text-highlighted text-xs font-bold ring-1 ring-inverted/20">
            {{ (currentWorkspace?.workspaceName ?? 'W').charAt(0).toUpperCase() }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-highlighted">
              {{ currentWorkspace?.workspaceName }}
            </p>
            <p class="truncate text-[11px] text-dimmed font-mono">
              {{ currentWorkspace?.siteId }}
            </p>
          </div>
          <UIcon
            name="i-lucide-chevrons-up-down"
            class="size-4 shrink-0 text-dimmed"
          />
        </button>

        <template #content>
          <div class="w-64 p-1">
            <p class="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-dimmed">
              Workspaces
            </p>
            <button
              v-for="w in workspaces"
              :key="w.workspaceId"
              class="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-elevated transition-colors"
              @click="pickWorkspace(w.workspaceId)"
            >
              <span class="grid place-items-center size-8 shrink-0 rounded-lg bg-elevated ring-1 ring-default text-xs font-bold text-muted">
                {{ w.workspaceName.charAt(0).toUpperCase() }}
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-highlighted">
                  {{ w.workspaceName }}
                </p>
                <p class="truncate text-[11px] text-dimmed font-mono">
                  {{ w.siteId }}
                </p>
              </div>
              <UIcon
                v-if="w.workspaceId === currentWorkspace?.workspaceId"
                name="i-lucide-check"
                class="size-4 shrink-0 text-highlighted"
              />
            </button>
          </div>
        </template>
      </UPopover>

      <!-- single workspace: static card -->
      <div
        v-else
        class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 bg-elevated/50 ring-1 ring-default"
      >
        <span class="grid place-items-center size-8 shrink-0 rounded-lg bg-inverted/15 text-highlighted text-xs font-bold ring-1 ring-inverted/20">
          {{ (currentWorkspace?.workspaceName ?? 'W').charAt(0).toUpperCase() }}
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-highlighted">
            {{ currentWorkspace?.workspaceName ?? 'Workspace' }}
          </p>
          <p class="truncate text-[11px] text-dimmed font-mono">
            {{ currentWorkspace?.siteId }}
          </p>
        </div>
      </div>
    </div>

    <!-- nav -->
    <nav class="flex-1 p-3 space-y-0.5">
      <NuxtLink
        v-for="item in nav"
        :key="item.label"
        :to="item.to"
        class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:text-highlighted hover:bg-elevated/60 transition-colors"
        @click="emit('navigate')"
      >
        <UIcon
          :name="item.icon"
          class="size-4.5"
        />
        {{ item.label }}
        <UBadge
          v-if="item.soon"
          color="neutral"
          variant="subtle"
          size="sm"
          class="ml-auto"
        >Soon</UBadge>
      </NuxtLink>
    </nav>

    <!-- user menu -->
    <div class="p-3 border-t border-default">
      <UDropdownMenu
        :items="[[
          { label: 'Sign out', icon: 'i-lucide-log-out', onSelect: logout }
        ]]"
      >
        <button class="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-elevated/60 transition-colors">
          <span class="grid place-items-center size-8 rounded-full bg-elevated ring-1 ring-default text-xs font-semibold text-highlighted">{{ initials }}</span>
          <div class="min-w-0 text-left">
            <p class="truncate text-sm font-medium text-highlighted">
              {{ user?.name }}
            </p>
            <p class="truncate text-[11px] text-dimmed">
              {{ user?.email }}
            </p>
          </div>
          <UIcon
            name="i-lucide-chevron-up"
            class="ml-auto size-4 text-dimmed"
          />
        </button>
      </UDropdownMenu>
    </div>
  </div>
</template>
