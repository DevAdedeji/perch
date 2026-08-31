import { eq, workspaces } from '@perch/db'

export default defineEventHandler(async (event) => {
  const siteId = getQuery(event).site_id
  if (typeof siteId !== 'string' || !siteId || siteId.length > 128) {
    throw createError({ statusCode: 400, statusMessage: 'Missing or invalid site id' })
  }

  const hostOrigin = normalizeInstallationOrigin(getHeader(event, 'origin'))
  if (!hostOrigin) {
    throw createError({ statusCode: 403, statusMessage: 'A valid browser origin is required' })
  }

  assertRateLimit('widget-embed-ticket:ip', requestIp(event), { max: 120, windowMs: 60_000 })
  assertRateLimit('widget-embed-ticket:site-origin', `${siteId}:${hostOrigin}`, { max: 60, windowMs: 60_000 })

  const workspace = await useDb().query.workspaces.findFirst({ where: eq(workspaces.siteId, siteId) })
  if (!workspace) throw createError({ statusCode: 404, statusMessage: 'Unknown site' })
  if (!isDomainAllowed(hostOrigin, workspace.allowedDomains)) {
    throw createError({ statusCode: 403, statusMessage: 'This site is not allowed to embed this chat' })
  }

  setResponseHeader(event, 'Access-Control-Allow-Origin', hostOrigin)
  setResponseHeader(event, 'Vary', 'Origin')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { embed_ticket: issueEmbedTicket(event, siteId, { hostOrigin }) }
})
