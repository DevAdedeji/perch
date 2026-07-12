import { and, articles, eq } from '@perch/db'

/** Delete a help-center article (admin only). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const articleId = getRouterParam(event, 'articleId')!
  await requireMembership(event, workspaceId, { admin: true })

  const [deleted] = await useDb().delete(articles)
    .where(and(eq(articles.id, articleId), eq(articles.workspaceId, workspaceId)))
    .returning()
  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Article not found' })
  }
  return { ok: true }
})
