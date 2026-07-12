import { and, articleGroups, articles, asc, eq, workspaces } from '@perch/db'
import { z } from 'zod'

/**
 * Public help-center content for the widget's Help tab: published articles
 * only, grouped. Help content is public by nature, so this needs only the
 * site check + rate limit — no visitor session.
 */
export default defineEventHandler(async (event) => {
  assertRateLimit('widget-articles:ip', requestIp(event), { max: 30, windowMs: 60 * 1000 })

  const query = await getValidatedQuery(event, q => z.object({ site_id: z.string().min(1) }).safeParse(q))
  if (!query.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input' })
  }

  const db = useDb()
  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.siteId, query.data.site_id)
  })
  if (!workspace) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown site' })
  }

  const [groups, rows] = await Promise.all([
    db.query.articleGroups.findMany({
      where: eq(articleGroups.workspaceId, workspace.id),
      orderBy: [asc(articleGroups.sortOrder), asc(articleGroups.createdAt)]
    }),
    db.query.articles.findMany({
      where: and(eq(articles.workspaceId, workspace.id), eq(articles.status, 'published')),
      orderBy: asc(articles.createdAt)
    })
  ])

  // groups with nothing published don't exist as far as visitors know
  return groups
    .map(g => ({
      id: g.id,
      name: g.name,
      description: g.description,
      articles: rows.filter(a => a.groupId === g.id).map(a => ({
        id: a.id,
        title: a.title,
        body: a.body,
        url: a.url
      }))
    }))
    .filter(g => g.articles.length > 0)
})
