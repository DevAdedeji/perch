/**
 * Global route guard implementing the onboarding funnel:
 *   not authed              → /login   (protected routes only)
 *   authed, no workspace    → /onboarding
 *   authed, has workspace   → /dashboard
 * Public: '/', '/login', '/signup', '/join/:token'.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { ensureLoaded, loggedIn, hasWorkspace } = useAuth()
  await ensureLoaded()

  const path = to.path
  const isJoin = path.startsWith('/join/')
  const isAuthPage = path === '/login' || path === '/signup'
  const isOnboarding = path === '/onboarding'
  const isDashboard = path === '/dashboard' || path.startsWith('/dashboard/')

  if (!loggedIn.value) {
    if (isOnboarding || isDashboard) {
      return navigateTo(`/login?redirect=${encodeURIComponent(path)}`)
    }
    return
  }

  // authenticated — keep them on the right side of the funnel
  if (isAuthPage) {
    return navigateTo(hasWorkspace.value ? '/dashboard' : '/onboarding')
  }
  if (isOnboarding && hasWorkspace.value) {
    return navigateTo('/dashboard')
  }
  if (isDashboard && !hasWorkspace.value) {
    return navigateTo('/onboarding')
  }
  // '/', join pages: always allowed
  void isJoin
})
