import { z } from 'zod'

/**
 * Public help-center content for the widget's Help tab: published articles
 * only, grouped. Help content is public by nature, so this needs only the
 * site check + rate limit — no visitor session.
 */
export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, q => z.object({
    site_id: z.string().regex(PUBLIC_HELP_SITE_ID_PATTERN)
  }).safeParse(q))
  if (!query.success) {
    throw createError({ statusCode: 404, statusMessage: 'Help center not found' })
  }

  assertRateLimit('widget-articles:site-ip', `${query.data.site_id}:${requestIp(event)}`, { max: 120, windowMs: 60 * 1000 })

  const db = useDb()
  const workspaceId = await findPublicHelpWorkspaceId(db, query.data.site_id)
  if (!workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown site' })
  }

  return listPublishedHelpGroups(db, workspaceId)
})
