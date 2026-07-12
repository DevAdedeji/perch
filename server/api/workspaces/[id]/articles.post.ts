import { and, articleGroups, articles, count, eq } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  group_id: z.string().uuid(),
  title: z.string().trim().min(1, 'Give the article a title').max(160),
  body: z.string().trim().max(20000).default(''),
  // link to an FAQ that already lives on the business's own site
  url: z.string().trim().url('Enter a valid link (https://…)').max(500).optional(),
  status: z.enum(['draft', 'published']).default('draft')
}).refine(d => d.body.length > 0 || d.url, { message: 'Write a body or add a link' })

/** Create a help-center article (admin only). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId, { admin: true })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid input' })
  }

  const db = useDb()
  // the group must belong to this workspace — no cross-tenant parenting
  const group = await db.query.articleGroups.findFirst({
    where: and(eq(articleGroups.id, result.data.group_id), eq(articleGroups.workspaceId, workspaceId))
  })
  if (!group) {
    throw createError({ statusCode: 404, statusMessage: 'Group not found' })
  }
  const [{ existing }] = await db
    .select({ existing: count() })
    .from(articles)
    .where(eq(articles.workspaceId, workspaceId)) as [{ existing: number }]
  if (existing >= 200) {
    throw createError({ statusCode: 400, statusMessage: 'A workspace can have at most 200 articles' })
  }

  const [article] = await db.insert(articles).values({
    groupId: group.id,
    workspaceId,
    title: result.data.title,
    body: result.data.body,
    url: result.data.url || null,
    status: result.data.status
  }).returning()

  setResponseStatus(event, 201)
  return {
    id: article!.id,
    group_id: article!.groupId,
    title: article!.title,
    body: article!.body,
    url: article!.url,
    status: article!.status,
    updated_at: article!.updatedAt
  }
})
