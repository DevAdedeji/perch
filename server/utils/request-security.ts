export const MAX_API_REQUEST_BYTES = 2 * 1024 * 1024

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const CROSS_ORIGIN_MUTATION_PATHS = new Set(['/api/widget/embed-ticket'])

function cleanPath(path: string): string {
  return path.split('?')[0] ?? path
}

function normalizedOrigin(input: unknown): string | null {
  if (typeof input !== 'string' || !input.trim()) return null
  try {
    const url = new URL(input.trim())
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null
    return url.origin === input.trim() ? url.origin : null
  } catch {
    return null
  }
}

export function isApiMutation(path: string, method: string): boolean {
  return cleanPath(path).startsWith('/api/') && MUTATION_METHODS.has(method.toUpperCase())
}

export function requiresTrustedMutationOrigin(path: string, method: string): boolean {
  const pathname = cleanPath(path)
  return isApiMutation(pathname, method)
    && !pathname.startsWith('/api/webhooks/')
    && !CROSS_ORIGIN_MUTATION_PATHS.has(pathname)
}

export function isTrustedMutationOrigin(requestOrigin: unknown, applicationOrigin: unknown): boolean {
  const supplied = normalizedOrigin(requestOrigin)
  const expected = normalizedOrigin(applicationOrigin)
  return Boolean(supplied && expected && supplied === expected)
}

export function hasRequestBody(contentLength: unknown, transferEncoding: unknown): boolean {
  if (typeof transferEncoding === 'string' && transferEncoding.trim()) return true
  if (typeof contentLength !== 'string' || !contentLength.trim()) return false
  const parsed = Number(contentLength)
  return Number.isSafeInteger(parsed) && parsed > 0
}

export function acceptsApiContentType(path: string, contentType: unknown): boolean {
  if (typeof contentType !== 'string') return false
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase()
  return cleanPath(path) === '/api/attachments/upload'
    ? mediaType === 'multipart/form-data'
    : mediaType === 'application/json'
}

export function contentSecurityPolicy(frameAncestors: string): string {
  return `base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors ${frameAncestors}`
}

export function isCookieFreePublicRequest(path: string, installationPreview = false): boolean {
  const pathname = cleanPath(path)
  return pathname === '/'
    || pathname === '/widget.js'
    || pathname === '/api/live'
    || pathname === '/api/health'
    || pathname === '/robots.txt'
    || pathname === '/sitemap.xml'
    || pathname.startsWith('/help/')
    || pathname.startsWith('/api/widget/')
    || pathname.startsWith('/api/webhooks/')
    || (pathname === '/widget' && !installationPreview)
}

export function safeErrorSummary(error: unknown): Record<string, string | number> {
  if (!error || typeof error !== 'object') return { type: typeof error }
  const candidate = error as { name?: unknown, code?: unknown, statusCode?: unknown }
  const summary: Record<string, string | number> = {
    type: typeof candidate.name === 'string' ? candidate.name.slice(0, 80) : 'Error'
  }
  if (typeof candidate.code === 'string') summary.code = candidate.code.slice(0, 80)
  if (typeof candidate.statusCode === 'number') summary.statusCode = candidate.statusCode
  return summary
}
