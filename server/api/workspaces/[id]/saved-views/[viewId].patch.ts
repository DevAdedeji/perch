import { and, eq, inboxSavedViews } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  filters: savedInboxFiltersSchema.optional()
}).strict().refine(value => value.name !== undefined || value.filters !== undefined, { message: 'No changes provided' })

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const viewId = getRouterParam(event, 'viewId')!
  const { member } = await requireMembership(event, workspaceId)
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid saved view', data: result.error.flatten() })
  }
  if (result.data.filters && member.role === 'agent' && !['any', 'me', 'unassigned', member.id].includes(result.data.filters.assignee)) {
    throw createError({ statusCode: 403, statusMessage: 'You cannot save another agent\'s inbox' })
  }
  if (result.data.filters) await assertInboxFilterReferences(workspaceId, result.data.filters)

  try {
    const [view] = await useDb().update(inboxSavedViews).set({
      ...result.data,
      updatedAt: new Date()
    }).where(and(
      eq(inboxSavedViews.id, viewId),
      eq(inboxSavedViews.memberId, member.id)
    )).returning()
    if (!view) throw createError({ statusCode: 404, statusMessage: 'Saved view not found' })
    return { id: view.id, name: view.name, filters: view.filters }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw createError({ statusCode: 409, statusMessage: 'You already have a saved view with this name' })
    }
    throw error
  }
})
