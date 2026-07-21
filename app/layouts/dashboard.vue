<script setup lang="ts">
import { channels } from '@perch/shared'
import type { ServerEvent } from '@perch/shared'

const { user, currentWorkspace } = useAuth()
const rt = useRealtime()
const toast = useToast()
const { play } = useNotificationSound()
const route = useRoute()

const drawerOpen = ref(false)
const wid = computed(() => currentWorkspace.value?.workspaceId ?? null)
// the conversation the agent is actively viewing (set by the inbox)
const activeConversationId = useState<string | null>('inbox:activeId', () => null)
// a mention toast can ask the inbox to open a specific conversation
const pendingSelect = useState<string | null>('inbox:pendingSelect', () => null)

function openDrawer() {
  drawerOpen.value = true
}

/* unverified-email nudge (dismisses for the session, not forever) */
const verifyDismissed = useState('verify:dismissed', () => false)
const showVerifyBanner = computed(() =>
  !!user.value && !user.value.emailVerified && !verifyDismissed.value
)
const resendingVerification = ref(false)

async function resendVerification() {
  if (resendingVerification.value) return
  resendingVerification.value = true
  try {
    await $fetch('/api/auth/send-verification', { method: 'POST' })
    toast.add({ title: 'Verification email sent', description: 'Check your inbox for the link.', icon: 'i-lucide-mail-check', color: 'success' })
  } catch (e) {
    toast.add({ title: getErrorMessage(e, 'Could not send the email'), color: 'error' })
  } finally {
    resendingVerification.value = false
  }
}

// close the mobile drawer on route change
watch(() => route.fullPath, () => {
  drawerOpen.value = false
})

/* team presence for the window chrome (mirrors the landing mock) */
interface ChromeMember {
  id: string
  name: string
  presence: 'online' | 'away' | 'offline'
}

const team = ref<ChromeMember[]>([])

async function loadTeam() {
  if (!wid.value) return
  try {
    team.value = await $fetch<ChromeMember[]>(`/api/workspaces/${wid.value}/members`)
  } catch {
    // the chrome is decorative — never block the app on it
  }
}

/**
 * In-dashboard new-message notifications (§3.4). The layout owns the workspace
 * subscription so this fires on any dashboard page (inbox, team, settings), and
 * so agent presence stays stable across in-app navigation. Skipped when the
 * agent is already looking at that exact conversation in a focused tab.
 */
function onEvent(ev: ServerEvent) {
  // someone @mentioned this agent in an internal note
  if (ev.type === 'mention') {
    toast.add({
      title: `${ev.payload.by_name} mentioned you`,
      description: ev.payload.excerpt,
      icon: 'i-lucide-at-sign',
      color: 'warning',
      actions: [{
        label: 'View',
        onClick: () => {
          pendingSelect.value = ev.payload.conversation_id
          navigateTo('/dashboard')
        }
      }]
    })
    play()
    return
  }
  if (ev.type === 'presence') {
    const member = team.value.find(m => m.id === ev.payload.member_id)
    if (member) member.presence = ev.payload.presence
    return
  }
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
  if (wid.value) {
    rt.subscribe(channels.workspace(wid.value))
    loadTeam()
  }
})
onBeforeUnmount(() => {
  off?.()
  if (wid.value) rt.unsubscribe(channels.workspace(wid.value))
})
watch(wid, (next, prev) => {
  if (prev) rt.unsubscribe(channels.workspace(prev))
  if (next) {
    rt.subscribe(channels.workspace(next))
    loadTeam()
  }
})
</script>

<template>
  <!-- the whole app lives in a floating window on the blueprint grid — the landing mock, for real -->
  <div class="h-screen p-2 sm:p-3 lg:p-4 bg-elevated/30 bg-grid">
    <div class="flex flex-col h-full rounded-2xl border-glow bg-default overflow-hidden shadow-2xl shadow-black/10">
      <!-- window chrome -->
      <header class="h-12 shrink-0 flex items-center gap-3 px-3 sm:px-4 border-b border-default bg-elevated/40">
        <UButton
          class="md:hidden"
          color="neutral"
          variant="ghost"
          icon="i-lucide-menu"
          aria-label="Open menu"
          @click="openDrawer"
        />
        <div class="hidden md:flex items-center gap-1.5">
          <span class="size-2.5 rounded-full bg-red-400/80" />
          <span class="size-2.5 rounded-full bg-amber-400/80" />
          <span class="size-2.5 rounded-full bg-green-400/80" />
        </div>
        <span class="hidden md:block ml-1 font-mono text-[11px] text-dimmed">perch — control room</span>
        <span class="md:hidden font-display text-sm font-semibold text-highlighted truncate">{{ currentWorkspace?.workspaceName }}</span>

        <div class="ml-auto flex items-center gap-3">
          <span
            class="hidden sm:flex items-center gap-1.5 text-[11px]"
            :class="rt.status.value === 'open' ? 'text-green-600 dark:text-green-500' : 'text-dimmed'"
          >
            <span
              class="size-1.5 rounded-full"
              :class="rt.status.value === 'open' ? 'bg-green-500 animate-pulse' : 'bg-zinc-400'"
            />
            {{ rt.status.value === 'open' ? 'Live' : 'connecting…' }}
          </span>

          <UColorModeButton />
        </div>
      </header>

      <!-- unverified-email nudge -->
      <div
        v-if="showVerifyBanner"
        class="shrink-0 flex items-center gap-3 px-3 sm:px-4 py-2 bg-amber-500/10 border-b border-amber-500/25"
      >
        <UIcon
          name="i-lucide-mail-warning"
          class="hidden sm:block size-4 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <p class="flex-1 min-w-0 text-xs sm:text-sm text-amber-700 dark:text-amber-400 truncate">
          Verify your email address to secure your account.
        </p>
        <UButton
          color="neutral"
          variant="outline"
          size="xs"
          :loading="resendingVerification"
          @click="resendVerification"
        >
          Resend email
        </UButton>
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-x"
          aria-label="Dismiss"
          @click="() => { verifyDismissed = true }"
        />
      </div>

      <div class="flex flex-1 min-h-0">
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
        <main class="flex-1 overflow-hidden min-w-0">
          <slot />
        </main>
      </div>
    </div>
  </div>
</template>
