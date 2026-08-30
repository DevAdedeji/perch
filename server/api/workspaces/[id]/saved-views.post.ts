import { inboxSavedViews } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().min(1).max(50),
  filters: savedInboxFiltersSchema
}).strict()

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { member } = await requireMembership(event, workspaceId)
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid saved view', data: result.error.flatten() })
  }
  if (member.role === 'agent' && !['any', 'me', 'unassigned', member.id].includes(result.data.filters.assignee)) {
    throw createError({ statusCode: 403, statusMessage: 'You cannot save another agent\'s inbox' })
  }
  await assertInboxFilterReferences(workspaceId, result.data.filters)

  try {
    const [view] = await useDb().insert(inboxSavedViews).values({
      memberId: member.id,
      name: result.data.name,
      filters: result.data.filters
    }).returning()
    setResponseStatus(event, 201)
    return { id: view!.id, name: view!.name, filters: view!.filters }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw createError({ statusCode: 409, statusMessage: 'You already have a saved view with this name' })
    }
    throw error
  }
})
