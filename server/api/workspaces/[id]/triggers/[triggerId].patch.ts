import { and, eq, triggers } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  url_match: z.string().trim().max(200).optional(),
  dwell_seconds: z.number().int().min(3).max(3600).optional(),
  message: z.string().trim().min(1).max(1000).optional(),
  enabled: z.boolean().optional()
}).refine(d => Object.keys(d).length > 0, { message: 'Nothing to update' })

/** Update a proactive trigger (admin) — partial; also the enable/disable toggle. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const triggerId = getRouterParam(event, 'triggerId')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid input' })
  }
  const d = result.data

  const [row] = await useDb().update(triggers)
    .set({
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.url_match !== undefined ? { urlMatch: d.url_match } : {}),
      ...(d.dwell_seconds !== undefined ? { dwellSeconds: d.dwell_seconds } : {}),
      ...(d.message !== undefined ? { message: d.message } : {}),
      ...(d.enabled !== undefined ? { enabled: d.enabled } : {})
    })
    .where(and(eq(triggers.id, triggerId), eq(triggers.workspaceId, workspaceId)))
    .returning()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Trigger not found' })
  }

  invalidateTriggerCache(workspaceId)
  logAudit(workspaceId, user, 'trigger.updated', { name: row.name, changed: Object.keys(d) })

  return {
    id: row.id,
    name: row.name,
    url_match: row.urlMatch,
    dwell_seconds: row.dwellSeconds,
    message: row.message,
    enabled: row.enabled
  }
})
