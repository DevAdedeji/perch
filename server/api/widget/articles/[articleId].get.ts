import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const params = await getValidatedRouterParams(event, value => z.object({
    articleId: z.string().regex(PUBLIC_HELP_ARTICLE_ID_PATTERN)
  }).safeParse(value))
  const query = await getValidatedQuery(event, value => z.object({
    site_id: z.string().regex(PUBLIC_HELP_SITE_ID_PATTERN)
  }).safeParse(value))
  if (!params.success || !query.success) {
    throw createError({ statusCode: 404, statusMessage: 'Article not found' })
  }

  assertRateLimit('widget-article:site-ip', `${query.data.site_id}:${requestIp(event)}`, { max: 300, windowMs: 60 * 1000 })

  const db = useDb()
  const workspaceId = await findPublicHelpWorkspaceId(db, query.data.site_id)
  if (!workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Article not found' })
  }

  const article = await findPublishedHelpArticle(db, workspaceId, params.data.articleId)
  if (!article) {
    throw createError({ statusCode: 404, statusMessage: 'Article not found' })
  }

  return article
})
