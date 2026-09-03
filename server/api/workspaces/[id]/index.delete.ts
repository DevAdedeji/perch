import { z } from 'zod'

const schema = z.object({
  confirmation: z.string().min(1).max(200)
}).strict()

/**
 * Delete a workspace and everything in it (admin only). The schema cascades:
 * members, invites, visitors, conversations, messages, read state, and canned
 * responses all go with it. Irreversible by design — the UI requires typing
 * the workspace name to confirm.
 */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  assertRateLimit('workspace-delete:ip', requestIp(event), { max: 5, windowMs: 15 * 60 * 1000 })
  const { user } = await requireMembership(event, workspaceId, { admin: true })
  const body = await readValidatedBody(event, value => schema.safeParse(value))
  if (!body.success) {
    throw createError({ statusCode: 400, statusMessage: 'Type the exact workspace name to confirm deletion.' })
  }

  const requirement = await prepareWorkspaceDeletion({
    workspaceId,
    userId: user.id,
    confirmation: body.data.confirmation
  })
  const billing = await confirmSubscriptionWillNotRenew(requirement)
  await recordBillingDeletionConfirmation(billing, 'workspace')
  await finalizeWorkspaceDeletion({
    workspaceId,
    userId: user.id,
    confirmationText: body.data.confirmation,
    billing
  })
  logDeletionReceipt({ kind: 'workspace', subjectId: workspaceId })
  return { ok: true }
})
