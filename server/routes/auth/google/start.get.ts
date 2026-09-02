import { safeAuthRedirect } from '@perch/shared'

export default defineEventHandler((event) => {
  assertRateLimit('google-oauth:ip', requestIp(event), { max: 20, windowMs: 15 * 60 * 1000 })

  if (!googleOAuthConfigured(event)) {
    throw createError({ statusCode: 503, statusMessage: 'Google sign-in is not configured.' })
  }

  const query = getQuery(event)
  const source = query.source === 'signup' ? 'signup' : 'login'
  const fallback = source === 'signup' ? '/onboarding' : '/dashboard'
  const redirect = safeAuthRedirect(query.redirect, fallback)

  setGoogleOAuthContext(event, { redirect, source })
  return sendRedirect(event, '/auth/google')
})
