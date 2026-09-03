import { eq, workspaces } from '@perch/db'

/**
 * Delete a workspace and everything in it (admin only). The schema cascades:
 * members, invites, visitors, conversations, messages, read state, and canned
 * responses all go with it. Irreversible by design — the UI requires typing
 * the workspace name to confirm.
 */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })

  await useDb().transaction(async (tx) => {
    const [workspace] = await tx.select().from(workspaces)
      .where(eq(workspaces.id, workspaceId)).for('update')
    if (!workspace) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
    await queueWorkspaceAttachmentCleanup(tx, {
      workspaceId,
      uploaderUserId: user.id,
      legacyLogoUrl: workspace.logoAssetId ? null : workspace.logoUrl
    })
    await tx.delete(workspaces).where(eq(workspaces.id, workspaceId))
  })
  logDeletionReceipt({ kind: 'workspace', subjectId: workspaceId })
  return { ok: true }
})
