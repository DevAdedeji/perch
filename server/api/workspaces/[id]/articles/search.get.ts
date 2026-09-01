import { workspaces, eq } from '@perch/db'
import { z } from 'zod'

const querySchema = z.object({
  q: z.string().trim().max(PUBLIC_HELP_SEARCH_MAX_LENGTH).optional()
})

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId)

  const query = await getValidatedQuery(event, value => querySchema.safeParse(value))
  if (!query.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid article search' })
  }

  const db = useDb()
  const workspace = await db.query.workspaces.findFirst({
    columns: { siteId: true },
    where: eq(workspaces.id, workspaceId)
  })
  if (!workspace) {
    throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  }

  const rows = await listPublishedHelpSuggestions(db, workspaceId, query.data.q || undefined)
  const origin = publicOrigin(event)

  return rows.map((article) => {
    const externalUrl = normalizePublicArticleUrl(article.url)
    return {
      id: article.id,
      title: article.title,
      excerpt: article.excerpt,
      group: article.group,
      url: externalUrl ?? `${origin}/help/${workspace.siteId}/${article.id}`,
      external: Boolean(externalUrl)
    }
  })
})
