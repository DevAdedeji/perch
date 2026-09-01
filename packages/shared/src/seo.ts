import { PERCH_PRODUCTION_ORIGIN } from './constants'

/** Public pages that may appear in search results. */
export const PERCH_INDEXABLE_PATHS = ['/', '/pricing', '/privacy', '/terms'] as const

/** Private/product routes that crawlers do not need to request. */
export const PERCH_ROBOTS_DISALLOWED_PATHS = [
  '/api/',
  '/account',
  '/admin/',
  '/articles',
  '/auth/',
  '/billing',
  '/dashboard',
  '/installation',
  '/join/',
  '/nest',
  '/onboarding',
  '/settings',
  '/team',
  '/visitors',
  '/widget'
] as const

export function isPerchProductionOrigin(value: string) {
  try {
    return new URL(value).origin === PERCH_PRODUCTION_ORIGIN
  } catch {
    return false
  }
}

export function isPerchIndexablePath(path: string) {
  return PERCH_INDEXABLE_PATHS.includes(path as typeof PERCH_INDEXABLE_PATHS[number])
    || /^\/help\/ws_[a-f0-9]{10}(?:\/[0-9a-f-]{36})?$/.test(path)
}
