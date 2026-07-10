import { randomBytes } from 'node:crypto'
import { eq, workspaces } from '@perch/db'

/** Workspace details for settings, plus the caller's role. */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { member } = await requireMembership(event, workspaceId)

  const db = useDb()
  let workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) })
  if (!workspace) {
    throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  }

  // lazily mint the identity-verification secret the first time an admin looks
  if (member.role === 'admin' && !workspace.identitySecret) {
    const [updated] = await db
      .update(workspaces)
      .set({ identitySecret: randomBytes(24).toString('hex') })
      .where(eq(workspaces.id, workspaceId))
      .returning()
    workspace = updated!
  }

  return {
    ...serializeWorkspace(workspace),
    role: member.role,
    identityVerificationEnabled: workspace.identityVerificationEnabled,
    // the secret is for the business's backend — admins only
    identitySecret: member.role === 'admin' ? workspace.identitySecret : null
  }
})
