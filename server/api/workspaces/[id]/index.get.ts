import { eq, workspaces } from '@perch/db'

/** Workspace details for settings, plus the caller's role. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { member } = await requireMembership(event, workspaceId)

  const db = useDb()
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) })
  if (!workspace) {
    throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  }
  return { ...serializeWorkspace(workspace), role: member.role }
})
