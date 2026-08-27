/**
 * Baseline security headers. The one carve-out is the widget frame: `/widget`
 * exists to be iframed by any customer site, so it advertises
 * `frame-ancestors *` — everything else (dashboard, auth, API) refuses to be
 * framed at all (clickjacking protection for an app full of other companies'
 * customer conversations).
 */
import { eq, workspaces } from '@perch/db'

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0] ?? ''

  if (path === '/widget') {
    const siteId = getQuery(event).site_id
    if (typeof siteId !== 'string' || !siteId) {
      throw createError({ statusCode: 400, statusMessage: 'Missing site id' })
    }
    const workspace = await useDb().query.workspaces.findFirst({ where: eq(workspaces.siteId, siteId) })
    if (!workspace) throw createError({ statusCode: 404, statusMessage: 'Unknown site' })

    const referer = getHeader(event, 'referer')
    if (!isDomainAllowed(referer, workspace.allowedDomains)) {
      throw createError({ statusCode: 403, statusMessage: 'This site is not allowed to embed this chat' })
    }
    event.context.perchEmbedTicket = issueEmbedTicket(event, siteId)
    const ancestors = workspace.allowedDomains.length
      ? workspace.allowedDomains.flatMap(domain => [
          `https://${domain}`, `https://*.${domain}`, `http://${domain}`, `http://*.${domain}`
        ]).join(' ')
      : '*'
    setResponseHeader(event, 'Content-Security-Policy', `frame-ancestors ${ancestors}`)
  } else {
    setResponseHeader(event, 'X-Frame-Options', 'DENY')
    setResponseHeader(event, 'Content-Security-Policy', 'frame-ancestors \'none\'')
  }

  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')
  setResponseHeader(event, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  removeResponseHeader(event, 'X-Powered-By')
  // HSTS only matters (and is only safe) over TLS — i.e. production
  if (!import.meta.dev) {
    setResponseHeader(event, 'Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
})
