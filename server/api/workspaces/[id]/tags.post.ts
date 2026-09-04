import { z } from 'zod'
import { createWorkspaceTag } from '../../../utils/workspace-resources'

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

  const { tag, created } = await createWorkspaceTag(useDb(), workspaceId, result.data.name)
  if (created) setResponseStatus(event, 201)
  return { id: tag.id, name: tag.name }
})
