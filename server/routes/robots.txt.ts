import { PERCH_ROBOTS_DISALLOWED_PATHS, isPerchProductionOrigin } from '@perch/shared'

export default defineEventHandler((event) => {
  const requestOrigin = getRequestURL(event, {
    xForwardedHost: true,
    xForwardedProto: true
  }).origin

  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400')

  if (!isPerchProductionOrigin(requestOrigin)) {
    return 'User-agent: *\nDisallow: /\n'
  }

  return [
    'User-agent: *',
    ...PERCH_ROBOTS_DISALLOWED_PATHS.map(path => `Disallow: ${path}`),
    '',
    `Sitemap: ${requestOrigin}/sitemap.xml`,
    ''
  ].join('\n')
})
