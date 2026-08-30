const SITE_ID_RE = /^ws_[a-z0-9]+$/

/** Build the exact script tag customers paste into their site. */
export function buildEmbedSnippet(origin: string, siteId: string): string {
  const url = new URL(origin)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new TypeError('Embed origin must be an HTTP(S) origin without credentials')
  }
  if (!SITE_ID_RE.test(siteId)) {
    throw new TypeError('Invalid Perch site id')
  }

  const widgetUrl = new URL('/widget.js', url.origin).href
  return `<script src="${widgetUrl}" data-site-id="${siteId}" async></script>`
}
