import { PERCH_INDEXABLE_PATHS } from '@perch/shared'

const MAX_SITEMAP_URLS = 50_000

function xml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll(/\u0027/g, '&apos;')
}

export default defineEventHandler(async (event) => {
  const origin = publicOrigin(event)
  const capacity = MAX_SITEMAP_URLS - PERCH_INDEXABLE_PATHS.length
  const entries = await listPublishedHelpSitemapEntries(useDb(), capacity)
  const paths = [...PERCH_INDEXABLE_PATHS, ...publicHelpSitemapPaths(entries, capacity)]
  const urls = paths.map(path => `  <url>
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
