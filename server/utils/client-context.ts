export const SESSION_IDLE_TTL_MS = 90 * 24 * 60 * 60 * 1000
export const SESSION_IP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export type ClientBrowser = 'Chrome' | 'Edge' | 'Firefox' | 'Opera' | 'Safari' | 'Browser'
export type ClientOs = 'Android' | 'ChromeOS' | 'iOS' | 'Linux' | 'macOS' | 'Windows' | null
export type ClientDevice = 'desktop' | 'mobile' | 'tablet' | 'unknown'

export interface ClientContext {
  browser: ClientBrowser
  os: ClientOs
  device: ClientDevice
}

const SESSION_CONTEXT_PREFIX = 'perch-device:v1:'

/** Reduce a user-agent string to the three labels the product actually uses. */
export function parseClientContext(userAgent?: string | null): ClientContext {
  const ua = userAgent ?? ''
  const browser: ClientBrowser = /edg\//i.test(ua)
    ? 'Edge'
    : /opr\/|opera/i.test(ua)
      ? 'Opera'
      : /firefox|fxios/i.test(ua)
        ? 'Firefox'
        : /chrome|crios/i.test(ua)
          ? 'Chrome'
          : /safari/i.test(ua) && /version\//i.test(ua)
            ? 'Safari'
            : 'Browser'
  const os: ClientOs = /iphone|ipad|ipod/i.test(ua)
    ? 'iOS'
    : /android/i.test(ua)
      ? 'Android'
      : /cros/i.test(ua)
        ? 'ChromeOS'
        : /mac os x|macintosh/i.test(ua)
          ? 'macOS'
          : /windows/i.test(ua)
            ? 'Windows'
            : /linux/i.test(ua)
              ? 'Linux'
              : null
  const device: ClientDevice = /ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))
    ? 'tablet'
    : /iphone|ipod|android.*mobile|mobile/i.test(ua)
      ? 'mobile'
      : ua
        ? 'desktop'
        : 'unknown'

  return { browser, os, device }
}

/** Persist only coarse labels, never the raw user agent or version numbers. */
export function encodeSessionClientContext(userAgent?: string | null): string {
  const context = parseClientContext(userAgent)
  return `${SESSION_CONTEXT_PREFIX}${context.device}:${context.browser}:${context.os ?? ''}`
}

/** Read both privacy-safe v1 values and legacy raw user agents during cleanup. */
export function decodeSessionClientContext(stored?: string | null): ClientContext {
  if (!stored?.startsWith(SESSION_CONTEXT_PREFIX)) return parseClientContext(stored)
  const [device, browser, os] = stored.slice(SESSION_CONTEXT_PREFIX.length).split(':')
  const safeDevice: ClientDevice = ['desktop', 'mobile', 'tablet', 'unknown'].includes(device ?? '')
    ? device as ClientDevice
    : 'unknown'
  const safeBrowser: ClientBrowser = ['Chrome', 'Edge', 'Firefox', 'Opera', 'Safari', 'Browser'].includes(browser ?? '')
    ? browser as ClientBrowser
    : 'Browser'
  const safeOs: ClientOs = ['Android', 'ChromeOS', 'iOS', 'Linux', 'macOS', 'Windows'].includes(os ?? '')
    ? os as Exclude<ClientOs, null>
    : null
  return { browser: safeBrowser, os: safeOs, device: safeDevice }
}

export function isEncodedSessionClientContext(value?: string | null): boolean {
  return value?.startsWith(SESSION_CONTEXT_PREFIX) === true
}
