import { articleGroups, articles, asc, eq } from '@perch/db'

/** All help-center groups + articles (drafts included) for the dashboard. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId)

  const db = useDb()
  const [groups, rows] = await Promise.all([
    db.query.articleGroups.findMany({
      where: eq(articleGroups.workspaceId, workspaceId),
      orderBy: [asc(articleGroups.sortOrder), asc(articleGroups.createdAt)]
    }),
    db.query.articles.findMany({
      where: eq(articles.workspaceId, workspaceId),
      orderBy: asc(articles.createdAt)
    })
  ])

  return groups.map(g => ({
    id: g.id,
    name: g.name,
    description: g.description,
    sort_order: g.sortOrder,
    articles: rows.filter(a => a.groupId === g.id).map(a => ({
      id: a.id,
      title: a.title,
      body: a.body,
      url: a.url,
      status: a.status,
      updated_at: a.updatedAt
    }))
  }))
})
