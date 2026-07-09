import { cannedResponses } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  // stored WITHOUT the leading slash; the composer adds it when matching
  shortcut: z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/i, 'Shortcut must be letters, numbers or dashes'),
  content: z.string().min(1).max(2000)
})

/** Create a canned response (any member — templates are a team resource). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId)

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid input' })
  }
  const shortcut = result.data.shortcut.toLowerCase()

  try {
    const [row] = await useDb()
      .insert(cannedResponses)
      .values({ workspaceId, shortcut, content: result.data.content })
      .returning()
    return { id: row!.id, shortcut: row!.shortcut, content: row!.content }
  } catch (e) {
    // unique(workspace_id, shortcut)
    if ((e as { code?: string }).code === '23505') {
      throw createError({ statusCode: 409, statusMessage: `/${shortcut} already exists` })
    }
    throw e
  }
})
