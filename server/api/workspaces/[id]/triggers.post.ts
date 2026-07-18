import { count, eq, triggers } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().min(1).max(60),
  url_match: z.string().trim().max(200).default(''),
  dwell_seconds: z.number().int().min(3).max(3600),
  message: z.string().trim().min(1).max(1000)
})

const MAX_TRIGGERS = 20

/** Create a proactive trigger (admin). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid input' })
  }
  const { name, url_match, dwell_seconds, message } = result.data

  const db = useDb()
  const [{ n }] = await db.select({ n: count() }).from(triggers).where(eq(triggers.workspaceId, workspaceId)) as [{ n: number }]
  if (n >= MAX_TRIGGERS) {
    throw createError({ statusCode: 400, statusMessage: `A workspace can have at most ${MAX_TRIGGERS} triggers` })
  }

  const [row] = await db.insert(triggers).values({
    workspaceId,
    name,
    urlMatch: url_match,
    dwellSeconds: dwell_seconds,
    message
  }).returning()

  invalidateTriggerCache(workspaceId)
  logAudit(workspaceId, user, 'trigger.created', { name })

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
