<script setup lang="ts">
import { channels } from '@perch/shared'
import type { ServerEvent } from '@perch/shared'

const { currentWorkspace } = useAuth()
const rt = useRealtime()
const toast = useToast()
const { play } = useNotificationSound()
const route = useRoute()

const drawerOpen = ref(false)
const wid = computed(() => currentWorkspace.value?.workspaceId ?? null)
// the conversation the agent is actively viewing (set by the inbox)
const activeConversationId = useState<string | null>('inbox:activeId', () => null)

function openDrawer() {
  drawerOpen.value = true
}

// close the mobile drawer on route change
watch(() => route.fullPath, () => {
  drawerOpen.value = false
})

/**
 * In-dashboard new-message notifications (§3.4). The layout owns the workspace
 * subscription so this fires on any dashboard page (inbox, team, settings), and
 * so agent presence stays stable across in-app navigation. Skipped when the
 * agent is already looking at that exact conversation in a focused tab.
 */
function onEvent(ev: ServerEvent) {
  if (ev.type !== 'message.new' || ev.payload.sender_type !== 'visitor') return
  const viewing = !document.hidden
    && route.path === '/dashboard'
    && activeConversationId.value === ev.payload.conversation_id
  if (viewing) return

  toast.add({
    title: 'New message',
    description: ev.payload.content.slice(0, 90),
    icon: 'i-lucide-message-circle',
    color: 'neutral',
    actions: [{ label: 'View', onClick: () => { navigateTo('/dashboard') } }]
  })
  play()
}

let off: (() => void) | undefined
onMounted(() => {
  rt.connect()
  off = rt.on(onEvent)
  if (wid.value) rt.subscribe(channels.workspace(wid.value))
})
onBeforeUnmount(() => {
  off?.()
  if (wid.value) rt.unsubscribe(channels.workspace(wid.value))
})
watch(wid, (next, prev) => {
  if (prev) rt.unsubscribe(channels.workspace(prev))
  if (next) rt.subscribe(channels.workspace(next))
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
