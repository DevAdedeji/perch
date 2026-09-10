import { requireMembership } from '@@/server/domains/workspaces/access'
import { useDb } from '@@/server/database/client'
import { logAudit } from '@@/server/domains/workspaces/audit'
import { and, eq, tags } from '@perch/db'

/** Delete a tag everywhere it's applied (admin only — it's cross-conversation). */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const tagId = getRouterParam(event, 'tagId')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })

  const [deleted] = await useDb().delete(tags)
    .where(and(eq(tags.id, tagId), eq(tags.workspaceId, workspaceId)))
    .returning()
  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Tag not found' })
  }
  logAudit(workspaceId, user, 'tag.deleted', { name: deleted.name })
  return { ok: true }
})
