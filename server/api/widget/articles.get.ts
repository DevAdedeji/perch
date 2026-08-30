import { z } from 'zod'

/**
 * Public help-center content for the widget's Help tab: published articles
 * only, grouped. Help content is public by nature, so this needs only the
 * site check + rate limit — no visitor session.
 */
export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, q => z.object({
    site_id: z.unknown(),
    q: z.string().trim().max(PUBLIC_HELP_SEARCH_MAX_LENGTH).optional()
  }).safeParse(q))
  if (!query.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid help center search' })
  }
  if (typeof query.data.site_id !== 'string' || !PUBLIC_HELP_SITE_ID_PATTERN.test(query.data.site_id)) {
    throw createError({ statusCode: 404, statusMessage: 'Help center not found' })
  }

  assertRateLimit('widget-articles:site-ip', `${query.data.site_id}:${requestIp(event)}`, { max: 120, windowMs: 60 * 1000 })
  const search = query.data.q || undefined
  if (search) {
    assertRateLimit('widget-article-search:site-ip', `${query.data.site_id}:${requestIp(event)}`, { max: 60, windowMs: 60 * 1000 })
  }

  const db = useDb()
  const workspaceId = await findPublicHelpWorkspaceId(db, query.data.site_id)
  if (!workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown site' })
  }

  return listPublishedHelpGroups(db, workspaceId, search)
})
