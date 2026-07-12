import { and, articleGroups, articles, eq } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  body: z.string().trim().max(20000).optional(),
  url: z.string().trim().url('Enter a valid link (https://…)').max(500).nullable().optional(),
  status: z.enum(['draft', 'published']).optional(),
  group_id: z.string().uuid().optional()
})

/** Edit / publish / move a help-center article (admin only). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const articleId = getRouterParam(event, 'articleId')!
  await requireMembership(event, workspaceId, { admin: true })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input' })
  }

  const db = useDb()
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (result.data.title !== undefined) patch.title = result.data.title
  if (result.data.body !== undefined) patch.body = result.data.body
  if (result.data.url !== undefined) patch.url = result.data.url || null
  if (result.data.status !== undefined) patch.status = result.data.status
  if (result.data.group_id !== undefined) {
    const group = await db.query.articleGroups.findFirst({
      where: and(eq(articleGroups.id, result.data.group_id), eq(articleGroups.workspaceId, workspaceId))
    })
    if (!group) {
      throw createError({ statusCode: 404, statusMessage: 'Group not found' })
    }
    patch.groupId = group.id
  }

  const [updated] = await db.update(articles)
    .set(patch)
    .where(and(eq(articles.id, articleId), eq(articles.workspaceId, workspaceId)))
    .returning()
  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Article not found' })
  }
  if (!updated.body && !updated.url) {
    throw createError({ statusCode: 400, statusMessage: 'An article needs a body or a link' })
  }
  return {
    id: updated.id,
    group_id: updated.groupId,
    title: updated.title,
    body: updated.body,
    url: updated.url,
    status: updated.status,
    updated_at: updated.updatedAt
  }
})
