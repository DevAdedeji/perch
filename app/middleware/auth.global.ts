/**
 * Global route guard implementing the onboarding funnel:
 *   not authed              → /login   (protected routes only)
 *   authed, no workspace    → /onboarding
 *   authed, has workspace   → /dashboard
 * Public: '/', '/login', '/signup', '/join/:token'.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  // the embedded widget frame is a public visitor page — no session lookup
  if (to.path === '/widget' || to.path.startsWith('/help/')) return

  const { ensureLoaded, loggedIn, hasWorkspace, currentWorkspace } = useAuth()
  await ensureLoaded()

  const path = to.path
  const isJoin = path.startsWith('/join/')
  const isAuthPage = path === '/login' || path === '/signup'
  const isOnboarding = path === '/onboarding'
  const isOnboardingContinuation = isOnboarding
    && (to.query.continue === 'invites' || to.query.continue === 'install')
  // authed app routes that require a workspace
  const isApp = path === '/dashboard' || path.startsWith('/dashboard/')
    || path === '/analytics' || path === '/installation' || path === '/settings' || path === '/team' || path === '/account'
    || path === '/articles' || path === '/nest' || path === '/billing' || path === '/admin' || path.startsWith('/admin/')

  if (!loggedIn.value) {
    if (isOnboarding || isApp) {
      return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`)
    }
    return
  }

  // authenticated — keep them on the right side of the funnel
  if (isAuthPage) {
    return navigateTo(hasWorkspace.value ? '/dashboard' : '/onboarding')
  }
  if (isOnboarding && hasWorkspace.value
    && (!isOnboardingContinuation || currentWorkspace.value?.role !== 'admin')) {
    return navigateTo('/dashboard')
  }
  if (isApp && !hasWorkspace.value) {
    return navigateTo('/onboarding')
  }
  // '/', join pages: always allowed
  void isJoin
})
