import type { H3Event } from 'h3'
import { and, eq, workspaceMembers } from '@perch/db'
import type { Workspace, WorkspaceMember } from '@perch/db'

/**
 * Assert the current user belongs to `workspaceId`, optionally requiring admin.
 * Returns the user and their membership row. Throws 403 otherwise.
 */
export async function requireMembership(
  event: H3Event,
  workspaceId: string,
  opts: { admin?: boolean } = {}
): Promise<{ user: SessionUser, member: WorkspaceMember }> {
  const user = await requireUser(event)
  const db = useDb()

  const member = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id))
  })
  if (!member) {
    throw createError({ statusCode: 403, statusMessage: 'You are not a member of this workspace' })
  }
  if (opts.admin && member.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }
  return { user, member }
}

/** Public-facing workspace shape returned to the dashboard. */
export function serializeWorkspace(w: Workspace) {
  return {
    id: w.id,
    name: w.name,
    siteId: w.siteId,
    logoUrl: w.logoUrl,
    widgetPrimaryColor: w.widgetPrimaryColor,
    autoAssignEnabled: w.autoAssignEnabled,
    prechatFormEnabled: w.prechatFormEnabled
  }
}
