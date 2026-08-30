import { PERCH_INDEXABLE_PATHS } from '@perch/shared'

function xml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll(/\u0027/g, '&apos;')
}

export default defineEventHandler((event) => {
  const origin = publicOrigin(event)
  const urls = PERCH_INDEXABLE_PATHS.map(path => `  <url>
    <loc>${xml(`${origin}${path === '/' ? '' : path}`)}</loc>
  </url>`).join('\n')

  setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
})
