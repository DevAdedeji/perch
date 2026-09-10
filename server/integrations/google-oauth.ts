import type { H3Event } from 'h3'
import { safeAuthRedirect } from '@perch/shared'

const REDIRECT_COOKIE = 'perch_google_oauth_redirect'
const SOURCE_COOKIE = 'perch_google_oauth_source'
const COOKIE_PATH = '/auth/google'
const COOKIE_MAX_AGE_SECONDS = 10 * 60

interface GoogleOAuthCredentials {
  clientId?: string
  clientSecret?: string
}

export function validateGoogleOAuthCredentials(credentials: GoogleOAuthCredentials) {
  const clientId = credentials.clientId?.trim() ?? ''
  const clientSecret = credentials.clientSecret?.trim() ?? ''

  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new Error('Google sign-in requires both a client ID and client secret.')
  }

  return Boolean(clientId && clientSecret)
}

export function googleOAuthConfigured(event?: H3Event) {
  const google = useRuntimeConfig(event).oauth?.google ?? {}
  return validateGoogleOAuthCredentials(google)
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: COOKIE_PATH,
    maxAge: COOKIE_MAX_AGE_SECONDS
  }
}

export function setGoogleOAuthContext(event: H3Event, input: {
  redirect: string
  source: 'login' | 'signup'
}) {
  const options = cookieOptions()
  setCookie(event, REDIRECT_COOKIE, input.redirect, options)
  setCookie(event, SOURCE_COOKIE, input.source, options)
}

export function consumeGoogleOAuthContext(event: H3Event) {
  const redirect = safeAuthRedirect(getCookie(event, REDIRECT_COOKIE), '/dashboard')
  const source: 'login' | 'signup' = getCookie(event, SOURCE_COOKIE) === 'signup' ? 'signup' : 'login'

  clearGoogleOAuthContext(event)

  return { redirect, source }
}

function clearGoogleOAuthContext(event: H3Event) {
  const options = { path: COOKIE_PATH }
  deleteCookie(event, REDIRECT_COOKIE, options)
  deleteCookie(event, SOURCE_COOKIE, options)
}

export function googleOAuthFailurePath(source: 'login' | 'signup', code: string) {
  return `/${source}?oauth_error=${encodeURIComponent(code)}`
}
