import { articleGroups, count, eq } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().min(1, 'Name the group').max(80),
  description: z.string().trim().max(300).optional()
})

/** Create a help-center group (admin only). New groups go to the end. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId, { admin: true })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid input' })
  }

  const db = useDb()
  const [{ existing }] = await db
    .select({ existing: count() })
    .from(articleGroups)
    .where(eq(articleGroups.workspaceId, workspaceId)) as [{ existing: number }]
  if (existing >= 20) {
    throw createError({ statusCode: 400, statusMessage: 'A workspace can have at most 20 groups' })
  }

  const [group] = await db.insert(articleGroups).values({
    workspaceId,
    name: result.data.name,
    description: result.data.description || null,
    sortOrder: existing
  }).returning()

  setResponseStatus(event, 201)
  return { id: group!.id, name: group!.name, description: group!.description, sort_order: group!.sortOrder, articles: [] }
})
