import { and, count, eq, inArray, sessions, sql, users, workspaceMembers, workspaces } from '@perch/db'
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

  const revokedSessionIds = await db.transaction(async (tx) => {
    const memberships = await tx.query.workspaceMembers.findMany({
      where: eq(workspaceMembers.userId, user.id)
    })
    // Stable ordering avoids deadlocks when two users share several workspaces.
    for (const workspaceId of memberships.map(m => m.workspaceId).sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`)
    }

    const soloWorkspaceIds: string[] = []
    for (const membership of memberships) {
      const [total] = await tx.select({ n: count() }).from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      if (Number(total?.n) === 1) {
        soloWorkspaceIds.push(membership.workspaceId)
        continue
      }
      if (membership.role === 'admin') {
        const [admins] = await tx.select({ n: count() }).from(workspaceMembers).where(and(
          eq(workspaceMembers.workspaceId, membership.workspaceId), eq(workspaceMembers.role, 'admin')
        ))
        if (Number(admins?.n) === 1) {
          const workspace = await tx.query.workspaces.findFirst({ where: eq(workspaces.id, membership.workspaceId) })
          throw createError({
            statusCode: 409,
            statusMessage: `You're the only admin of "${workspace?.name ?? 'a workspace'}" — promote a teammate or delete that workspace first`
          })
        }
      }
    }

    const activeSessions = await tx.query.sessions.findMany({
      where: eq(sessions.userId, user.id), columns: { id: true }
    })
    if (soloWorkspaceIds.length) await tx.delete(workspaces).where(inArray(workspaces.id, soloWorkspaceIds))
    await tx.delete(users).where(eq(users.id, user.id))
    return activeSessions.map(row => row.id)
  })

  forgetSessions(revokedSessionIds)
  await clearUserSession(event)
  return { ok: true }
})
