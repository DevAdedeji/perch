/**
 * The dashboard refuses framing. The widget is the deliberate exception and
 * receives a workspace-specific frame policy after its embed origin is proven.
 */
import { eq, workspaces } from '@perch/db'
import { randomUUID } from 'node:crypto'

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0] ?? ''
  const requestId = randomUUID()
  event.context.requestId = requestId
  setResponseHeader(event, 'X-Request-Id', requestId)
  setResponseHeader(event, 'X-Frame-Options', 'DENY')
  setResponseHeader(event, 'Content-Security-Policy', contentSecurityPolicy('\'none\''))
  setResponseHeader(event, 'Cross-Origin-Opener-Policy', 'same-origin')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Referrer-Policy', path.startsWith('/reply') ? 'no-referrer' : 'strict-origin-when-cross-origin')
  if (path.startsWith('/reply') || path.startsWith('/api/visitor-reply/')) {
    setResponseHeader(event, 'Cache-Control', 'no-store')
  }
  setResponseHeader(event, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  setResponseHeader(event, 'X-Permitted-Cross-Domain-Policies', 'none')
  setResponseHeader(event, 'Origin-Agent-Cluster', '?1')
  setResponseHeader(
    event,
    'Cross-Origin-Resource-Policy',
    path === '/widget' || path === '/widget.js' || path === '/api/widget/embed-ticket'
      ? 'cross-origin'
      : 'same-origin'
  )
  removeResponseHeader(event, 'X-Powered-By')
  if (!import.meta.dev) {
    setResponseHeader(event, 'Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }

  if (path === '/widget') {
    const siteId = getQuery(event).site_id
    if (typeof siteId !== 'string' || !siteId) {
      throw createError({ statusCode: 400, statusMessage: 'Missing site id' })
    }
    const workspace = await useDb().query.workspaces.findFirst({ where: eq(workspaces.siteId, siteId) })
    if (!workspace) throw createError({ statusCode: 404, statusMessage: 'Unknown site' })

    const installationPreview = getQuery(event).preview === '1'
    const suppliedTicket = getQuery(event).embed_ticket
    let embedOrigin: string | null
    if (installationPreview) {
      await requireMembership(event, workspace.id, { admin: true })
      embedOrigin = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
    } else {
      if (typeof suppliedTicket === 'string' && suppliedTicket) {
        const ticket = requireEmbedTicket(event, siteId, suppliedTicket)
        if (ticket.installationPreview) {
          throw createError({ statusCode: 403, statusMessage: 'Invalid embed session' })
        }
        embedOrigin = ticket.hostOrigin
      } else {
        embedOrigin = observedEmbedOrigin(getHeader(event, 'referer'), getHeader(event, 'origin'))
      }
      if (!embedOrigin || !isDomainAllowed(embedOrigin, workspace.allowedDomains)) {
        throw createError({ statusCode: 403, statusMessage: 'This site is not allowed to embed this chat' })
      }
    }
    event.context.perchEmbedOrigin = embedOrigin!
    event.context.perchEmbedTicket = issueEmbedTicket(event, siteId, {
      hostOrigin: embedOrigin!,
      installationPreview
    })
    const ancestors = installationPreview
      ? '\'self\''
      : workspace.allowedDomains.length
        ? workspace.allowedDomains.flatMap(domain => [
            `https://${domain}`, `https://*.${domain}`, `http://${domain}`, `http://*.${domain}`
          ]).join(' ')
        : '*'
    removeResponseHeader(event, 'X-Frame-Options')
    removeResponseHeader(event, 'Cross-Origin-Opener-Policy')
    setResponseHeader(event, 'Content-Security-Policy', contentSecurityPolicy(ancestors))
  }
})
