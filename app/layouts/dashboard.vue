<script setup lang="ts">
const { currentWorkspace } = useAuth()
const drawerOpen = ref(false)

function openDrawer() {
  drawerOpen.value = true
}

// close the mobile drawer on route change
const route = useRoute()
watch(() => route.fullPath, () => {
  drawerOpen.value = false
})
</script>

<template>
  <div class="flex h-screen bg-elevated/20">
    <!-- desktop sidebar -->
    <aside class="hidden md:flex w-60 shrink-0 overflow-hidden border-r border-default">
      <DashboardSidebar />
    </aside>

    <!-- mobile drawer -->
    <USlideover
      v-model:open="drawerOpen"
      side="left"
      :ui="{ content: 'w-72 max-w-[80vw]' }"
    >
      <template #content>
        <DashboardSidebar @navigate="drawerOpen = false" />
      </template>
    </USlideover>

    <!-- main -->
    <div class="flex-1 flex flex-col min-w-0">
      <header class="h-16 shrink-0 flex items-center justify-between gap-3 px-4 sm:px-5 border-b border-default bg-default">
        <div class="flex items-center gap-2 min-w-0">
          <UButton
            class="md:hidden"
            color="neutral"
            variant="ghost"
            icon="i-lucide-menu"
            aria-label="Open menu"
            @click="openDrawer"
          />
          <div class="flex items-center gap-2 md:hidden min-w-0">
            <PerchLogo :show-text="false" />
            <span class="font-display font-semibold text-highlighted truncate">{{ currentWorkspace?.workspaceName }}</span>
          </div>
        </div>
        <UColorModeButton />
      </header>

      <main class="flex-1 overflow-hidden">
        <slot />
      </main>
    </div>
  </div>
</template>
