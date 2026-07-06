<script setup lang="ts">
const { user, primaryWorkspace, logout } = useAuth()

const nav = [
  { label: 'Inbox', icon: 'i-lucide-inbox', to: '/dashboard', soon: false },
  { label: 'Team', icon: 'i-lucide-users', to: '/dashboard', soon: true },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/dashboard', soon: true }
]

const initials = computed(() =>
  (user.value?.name ?? '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
)
</script>

<template>
  <div class="flex h-screen bg-elevated/20">
    <!-- sidebar -->
    <aside class="hidden md:flex w-60 shrink-0 flex-col border-r border-default bg-default">
      <div class="h-16 flex items-center px-5 border-b border-default">
        <PerchLogo />
      </div>

      <div class="px-3 py-3 border-b border-default">
        <div class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 bg-elevated/50 ring-1 ring-default">
          <span class="grid place-items-center size-8 rounded-lg bg-amber-400/15 text-amber-400 text-xs font-bold ring-1 ring-amber-400/20">
            {{ (primaryWorkspace?.workspaceName ?? 'W').charAt(0).toUpperCase() }}
          </span>
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-highlighted">
              {{ primaryWorkspace?.workspaceName ?? 'Workspace' }}
            </p>
            <p class="truncate text-[11px] text-dimmed font-mono">
              {{ primaryWorkspace?.siteId }}
            </p>
          </div>
        </div>
      </div>

      <nav class="flex-1 p-3 space-y-0.5">
        <NuxtLink
          v-for="item in nav"
          :key="item.label"
          :to="item.to"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:text-highlighted hover:bg-elevated/60 transition-colors"
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

      <div class="p-3 border-t border-default">
        <UDropdownMenu
          :items="[[
            { label: user?.name ?? '', type: 'label' },
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
    </aside>

    <!-- main -->
    <div class="flex-1 flex flex-col min-w-0">
      <header class="h-16 shrink-0 flex items-center justify-between gap-3 px-5 border-b border-default bg-default">
        <div class="flex items-center gap-2 md:hidden">
          <PerchLogo :show-text="false" />
          <span class="font-display font-semibold text-highlighted">{{ primaryWorkspace?.workspaceName }}</span>
        </div>
        <div class="hidden md:block" />
        <div class="flex items-center gap-2">
          <UColorModeButton />
        </div>
      </header>

      <main class="flex-1 overflow-y-auto">
        <slot />
      </main>
    </div>
  </div>
</template>
