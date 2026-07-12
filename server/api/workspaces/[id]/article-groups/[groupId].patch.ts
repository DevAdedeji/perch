import { and, articleGroups, eq } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  sort_order: z.number().int().min(0).max(1000).optional()
})

/** Rename / reorder a help-center group (admin only). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const groupId = getRouterParam(event, 'groupId')!
  await requireMembership(event, workspaceId, { admin: true })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input' })
  }

  const patch: Record<string, unknown> = {}
  if (result.data.name !== undefined) patch.name = result.data.name
  if (result.data.description !== undefined) patch.description = result.data.description || null
  if (result.data.sort_order !== undefined) patch.sortOrder = result.data.sort_order

  const [updated] = await useDb().update(articleGroups)
    .set(patch)
    .where(and(eq(articleGroups.id, groupId), eq(articleGroups.workspaceId, workspaceId)))
    .returning()
  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Group not found' })
  }
  return { id: updated.id, name: updated.name, description: updated.description, sort_order: updated.sortOrder }
})
