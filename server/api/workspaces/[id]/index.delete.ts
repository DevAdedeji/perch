import { eq, workspaces } from '@perch/db'

/**
 * Delete a workspace and everything in it (admin only). The schema cascades:
 * members, invites, visitors, conversations, messages, read state, and canned
 * responses all go with it. Irreversible by design — the UI requires typing
 * the workspace name to confirm.
 */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId, { admin: true })

  await useDb().delete(workspaces).where(eq(workspaces.id, workspaceId))
  return { ok: true }
})
