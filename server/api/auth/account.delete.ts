import { and, count, eq, inArray, users, workspaceMembers, workspaces } from '@perch/db'
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
  if (!dbUser || !(await verifyPassword(dbUser.passwordHash, result.data.password))) {
    throw createError({ statusCode: 401, statusMessage: 'Incorrect password' })
  }

  const memberships = await db.query.workspaceMembers.findMany({
    where: eq(workspaceMembers.userId, user.id)
  })

  const soloWorkspaceIds: string[] = []
  for (const membership of memberships) {
    const [total] = await db
      .select({ n: count() })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, membership.workspaceId))

    if (Number(total?.n) === 1) {
      soloWorkspaceIds.push(membership.workspaceId)
      continue
    }

    if (membership.role === 'admin') {
      const [admins] = await db
        .select({ n: count() })
        .from(workspaceMembers)
        .where(and(
          eq(workspaceMembers.workspaceId, membership.workspaceId),
          eq(workspaceMembers.role, 'admin')
        ))
      if (Number(admins?.n) === 1) {
        const workspace = await db.query.workspaces.findFirst({
          where: eq(workspaces.id, membership.workspaceId)
        })
        throw createError({
          statusCode: 409,
          statusMessage: `You're the only admin of "${workspace?.name ?? 'a workspace'}" — promote a teammate or delete that workspace first`
        })
      }
    }
  }

  // solo workspaces go with the account; everything else cascades off the user row
  if (soloWorkspaceIds.length) {
    await db.delete(workspaces).where(inArray(workspaces.id, soloWorkspaceIds))
  }
  await db.delete(users).where(eq(users.id, user.id))

  await clearUserSession(event)
  return { ok: true }
})
