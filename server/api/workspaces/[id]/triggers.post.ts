import { z } from 'zod'
import { createWorkspaceTrigger } from '../../../utils/workspace-resources'

const schema = z.object({
  name: z.string().trim().min(1).max(60),
  url_match: z.string().trim().max(200).default(''),
  dwell_seconds: z.number().int().min(3).max(3600),
  message: z.string().trim().min(1).max(1000)
})

/** Create a proactive trigger (admin). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid input' })
  }
  const { name, url_match, dwell_seconds, message } = result.data

  const row = await createWorkspaceTrigger(useDb(), {
    workspaceId,
    name,
    urlMatch: url_match,
    dwellSeconds: dwell_seconds,
    message
  }, user)

  invalidateTriggerCache(workspaceId)

  setResponseStatus(event, 201)
  return {
    id: row!.id,
    name: row!.name,
    url_match: row!.urlMatch,
    dwell_seconds: row!.dwellSeconds,
    message: row!.message,
    enabled: row!.enabled
  }
})
