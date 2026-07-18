import { and, eq, triggers } from '@perch/db'

/** Delete a proactive trigger (admin). Fire history cascades away with it. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const triggerId = getRouterParam(event, 'triggerId')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })

  const [row] = await useDb().delete(triggers)
    .where(and(eq(triggers.id, triggerId), eq(triggers.workspaceId, workspaceId)))
    .returning()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Trigger not found' })
  }

  invalidateTriggerCache(workspaceId)
  logAudit(workspaceId, user, 'trigger.deleted', { name: row.name })

  return { ok: true }
})
