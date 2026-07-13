import { and, count, eq, tags } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().min(1, 'Name the tag').max(40).transform(v => v.toLowerCase())
})

/** Create a tag (any member — tagging is a team activity, not an admin one). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId)

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid input' })
  }

  const db = useDb()
  const [{ existing }] = await db
    .select({ existing: count() })
    .from(tags)
    .where(eq(tags.workspaceId, workspaceId)) as [{ existing: number }]
  if (existing >= 50) {
    throw createError({ statusCode: 400, statusMessage: 'A workspace can have at most 50 tags' })
  }

  const [tag] = await db.insert(tags)
    .values({ workspaceId, name: result.data.name })
    .onConflictDoNothing()
    .returning()
  if (!tag) {
    // name already exists — return the existing row so the client can just use it
    const dupe = await db.query.tags.findFirst({
      where: and(eq(tags.workspaceId, workspaceId), eq(tags.name, result.data.name))
    })
    return { id: dupe!.id, name: dupe!.name }
  }

  setResponseStatus(event, 201)
  return { id: tag.id, name: tag.name }
})
