export interface Membership {
  memberId: string
  role: 'admin' | 'agent'
  workspaceId: string
  workspaceName: string
  siteId: string
}

export interface AuthUser {
  id: string
  email: string
  name: string
}

interface AuthState {
  user: AuthUser | null
  workspaces: Membership[]
}

/**
 * Shared auth state: the session user + their workspace memberships.
 * Backed by `/api/auth/me`; cached in `useState` so a page load fetches once
 * (with SSR cookie forwarding) and every component reads the same snapshot.
 */
export function useAuth() {
  const state = useState<AuthState>('auth', () => ({ user: null, workspaces: [] }))
  const loaded = useState<boolean>('auth:loaded', () => false)

  async function refresh() {
    const request = useRequestFetch()
    try {
      state.value = await request<AuthState>('/api/auth/me')
    } catch {
      state.value = { user: null, workspaces: [] }
    }
    loaded.value = true
  }

  async function ensureLoaded() {
    if (!loaded.value) await refresh()
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST' })
    state.value = { user: null, workspaces: [] }
    loaded.value = true
    await navigateTo('/login')
  }

  return {
    user: computed(() => state.value.user),
    workspaces: computed(() => state.value.workspaces),
    loggedIn: computed(() => !!state.value.user),
    hasWorkspace: computed(() => state.value.workspaces.length > 0),
    primaryWorkspace: computed(() => state.value.workspaces[0] ?? null),
    refresh,
    ensureLoaded,
    logout
  }
}
