const AUTH_REDIRECT_BASE = 'https://perch.local'

/** Keep post-auth navigation on this Perch origin. */
export function safeAuthRedirect(value: unknown, fallback: string) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback
  }

  try {
    const url = new URL(value, AUTH_REDIRECT_BASE)
    if (url.origin !== AUTH_REDIRECT_BASE) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
