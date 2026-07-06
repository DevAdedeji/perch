import { eq, invites, workspaces } from '@perch/db'

/** Public: fetch invite details so the /join page can render before login. */
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')!
  const db = useDb()

  const invite = await db.query.invites.findFirst({ where: eq(invites.token, token) })
  if (!invite) {
    throw createError({ statusCode: 404, statusMessage: 'Invite not found' })
  }

  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, invite.workspaceId) })

  const expired = invite.expiresAt.getTime() < Date.now()
  const status = invite.status === 'pending' && expired ? 'expired' : invite.status

  return {
    email: invite.email,
    role: invite.role,
    status,
    workspace: workspace
      ? { name: workspace.name, logoUrl: workspace.logoUrl, widgetPrimaryColor: workspace.widgetPrimaryColor }
      : null
  }
})
