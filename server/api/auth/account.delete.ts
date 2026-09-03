import { eq, users } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  // deleting an account is the one action that always re-authenticates
  password: z.string().min(1, 'Enter your password')
})

/**
 * Delete the signed-in user's account.
 *
 * Workspace policy per membership:
 *  - sole member            → the workspace is deleted with the account
 *  - sole ADMIN with others → blocked; they must promote someone or delete
 *    the workspace first (otherwise the team would be locked out)
 *  - otherwise              → membership is removed (cascade), their assigned
 *    conversations return to the pool (assigned_agent_id → set null) and
 *    message history survives (sender_id → set null)
 */
export default defineEventHandler(async (event) => {
  assertRateLimit('account-delete:ip', requestIp(event), { max: 5, windowMs: 15 * 60 * 1000 })

  const user = await requireUser(event)
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Enter your password' })
  }

  const db = useDb()
  const dbUser = await db.query.users.findFirst({ where: eq(users.id, user.id) })
  if (!dbUser?.passwordHash) {
    throw createError({ statusCode: 409, statusMessage: 'Set a password before deleting your account.' })
  }
  if (!(await verifyPassword(dbUser.passwordHash, result.data.password))) {
    throw createError({ statusCode: 401, statusMessage: 'Incorrect password' })
  }

  const preparation = await prepareAccountDeletion(user.id)
  const billingConfirmations = []
  for (const requirement of preparation.requirements) {
    const confirmation = await confirmSubscriptionWillNotRenew(requirement)
    await recordBillingDeletionConfirmation(confirmation, 'account')
    billingConfirmations.push(confirmation)
  }
  const deletion = await finalizeAccountDeletion({
    userId: user.id,
    preparedWorkspaceIds: preparation.workspaceIds,
    billingConfirmations
  })

  logDeletionReceipt({
    kind: 'account',
    subjectId: user.id,
    cascadeWorkspaceIds: deletion.soloWorkspaceIds
  })
  forgetSessions(deletion.revokedSessionIds)
  await clearUserSession(event)
  return { ok: true }
})
